/**
 * Minimal glob → RegExp for path matching. Supports `**` (any depth, incl. /),
 * `*` (one segment), and `?`. Enough for productGlobs like "src/**".
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // "**/" also matches zero dirs
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Normalize to forward slashes and strip a leading "./". */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesAny(path: string, globs: string[]): boolean {
  const p = normalizePath(path);
  return globs.some((g) => globToRegExp(normalizePath(g)).test(p));
}
