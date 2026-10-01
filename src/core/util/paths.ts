/** Last path segment, for both Windows and POSIX separators. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Everything before the last path separator, or the path itself when there is none. */
export function parentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separator >= 0 ? path.slice(0, separator) : path;
}
