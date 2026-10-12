// Thrown when an optimistic-locking update loses a race (the case changed since it was read)
// or when a uniqueness rule (one active case per user per term) is violated by a concurrent write
export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}
