/** A problem the user can fix (bad file, app not running, port taken). The CLI prints it and exits 2. */
export class ToolError extends Error {
  override name = 'ToolError';
}
