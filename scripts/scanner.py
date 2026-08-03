import ast
from pathlib import Path


def _call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _string_value(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _find_urlpatterns(tree: ast.Module):
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "urlpatterns":
                    if isinstance(node.value, ast.List):
                        return node.value
    return None


def _find_project_root(start: Path):
    d = start.resolve().parent
    while d != d.parent:
        if (d / "manage.py").exists():
            return d
        d = d.parent
    return start.resolve().parent


def _resolve_include(current_file: Path, dotted_path: str):
    project_root = _find_project_root(current_file)
    candidate = project_root
    for part in dotted_path.split("."):
        candidate = candidate / part
    candidate = candidate.with_suffix(".py")
    if candidate.exists():
        return candidate
    matches = list(project_root.rglob(f"{dotted_path.split('.')[-1]}.py"))
    return matches[0] if matches else None


_METHOD_HINTS = {
    "ListAPIView": "GET",
    "RetrieveAPIView": "GET",
    "CreateAPIView": "POST",
    "UpdateAPIView": "PUT",
    "DestroyAPIView": "DELETE",
    "ListCreateAPIView": "GET",
    "RetrieveUpdateDestroyAPIView": "GET",
}


def _infer_method(urls_file: Path, class_name: str):
    for py_file in urls_file.parent.glob("*.py"):
        try:
            tree = ast.parse(py_file.read_text())
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == class_name:
                for base in node.bases:
                    if isinstance(base, ast.Attribute):
                        base_name = base.attr
                    else:
                        base_name = getattr(base, "id", None)
                    if base_name in _METHOD_HINTS:
                        return _METHOD_HINTS[base_name]
    return "GET"


def _infer_function_method(urls_file: Path, func_name: str):
    """Function-based views don't have a base class to read. Look for an
    @api_view([...]) decorator first (explicit, reliable), and fall back to
    scanning the function body for request.method comparisons. Returns a
    single method, or a "GET/POST" style string if multiple were found."""
    for py_file in urls_file.parent.glob("*.py"):
        try:
            tree = ast.parse(py_file.read_text())
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == func_name:
                for dec in node.decorator_list:
                    if isinstance(dec, ast.Call) and _call_name(dec.func) == "api_view" and dec.args:
                        arg = dec.args[0]
                        if isinstance(arg, (ast.List, ast.Tuple)):
                            methods = [_string_value(e) for e in arg.elts if _string_value(e)]
                            if methods:
                                return "/".join(methods)

                found = []
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Compare):
                        left_is_method = (
                            isinstance(inner.left, ast.Attribute) and inner.left.attr == "method"
                        )
                        if left_is_method:
                            for op, comparator in zip(inner.ops, inner.comparators):
                                if isinstance(op, ast.Eq):
                                    val = _string_value(comparator)
                                    if val:
                                        found.append(val)
                                elif isinstance(op, ast.In):
                                    if isinstance(comparator, (ast.List, ast.Tuple)):
                                        for e in comparator.elts:
                                            v = _string_value(e)
                                            if v:
                                                found.append(v)
                if found:
                    seen = []
                    for m in found:
                        if m not in seen:
                            seen.append(m)
                    return "/".join(seen)
                return "GET"
    return "GET"


def _extract_view_info(urls_file: Path, node):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "as_view":
        view_name = _call_name(node.func.value) or "UnknownView"
        method = _infer_method(urls_file, view_name)
        return view_name, method
    if isinstance(node, ast.Name):
        method = _infer_function_method(urls_file, node.id)
        return node.id, method
    if isinstance(node, ast.Attribute):
        method = _infer_function_method(urls_file, node.attr)
        return node.attr, method
    return "UnknownView", "GET"


def _walk_urlpatterns(urls_file: Path, prefix: str = "", visited=None):
    if visited is None:
        visited = set()
    resolved = urls_file.resolve()
    if resolved in visited:
        return []
    visited.add(resolved)

    results = []
    try:
        tree = ast.parse(urls_file.read_text())
    except (SyntaxError, UnicodeDecodeError, OSError):
        return results

    urlpatterns = _find_urlpatterns(tree)
    if urlpatterns is None:
        return results

    for element in urlpatterns.elts:
        if not isinstance(element, ast.Call) or not element.args:
            continue
        func_name = _call_name(element.func)
        if func_name not in ("path", "re_path"):
            continue
        url_part = _string_value(element.args[0]) or ""
        full_prefix = prefix + url_part
        if len(element.args) < 2:
            continue
        second_arg = element.args[1]

        if isinstance(second_arg, ast.Call) and _call_name(second_arg.func) == "include":
            if second_arg.args:
                target = _string_value(second_arg.args[0])
                if target:
                    sub_file = _resolve_include(urls_file, target)
                    if sub_file:
                        results.extend(_walk_urlpatterns(sub_file, full_prefix, visited))
            continue

        view_name, method = _extract_view_info(urls_file, second_arg)
        results.append({
            "path": "/" + full_prefix.lstrip("/"),
            "view": view_name,
            "app": urls_file.parent.name,
            "method": method,
        })

    return results


def scan_urls(project_root: str):
    root = Path(project_root)
    settings_file = next(root.rglob("settings.py"), None)
    if not settings_file:
        return []
    root_urls = settings_file.parent / "urls.py"
    if not root_urls.exists():
        return []
    return _walk_urlpatterns(root_urls)


if __name__ == "__main__":
    import sys
    import json
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    found = scan_urls(target)
    print(json.dumps(found, indent=2))
    print(f"\n{len(found)} routes found.")