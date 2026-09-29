export class WindowQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  get pendingCount(): number {
    return this.pending;
  }

  run<T>(fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
    const turn = this.tail.catch(() => {});
    this.pending++;
    const job = turn.then(() => fn());
    const done = job.finally(() => this.pending--);
    this.tail = done;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `window busy: timed out after ${timeoutMs}ms with ${this.pending} job(s) ahead or running — ` +
                `check chats_list before retrying chat_send, other tools are safe to retry`,
            ),
          ),
        timeoutMs,
      );
      job.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
