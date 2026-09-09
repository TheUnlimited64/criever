/** An error whose message is shown to the user verbatim and names the fix. */
export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError'; }
}
