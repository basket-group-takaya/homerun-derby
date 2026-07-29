/**
 * Minimal ambient declarations for the Node built-ins the test suite uses.
 *
 * PROMPT.md 1 fixes devDependencies at "typescript only", so @types/node is not
 * available. Rather than leave tests/ untypechecked, we declare exactly the
 * surface we call. Extend this when a test needs something new.
 */

declare module 'node:test' {
  type TestFn = () => void | Promise<void>;
  type TestOptions = {
    skip?: boolean | string;
    todo?: boolean | string;
    only?: boolean;
    concurrency?: number | boolean;
    timeout?: number;
  };

  function test(name: string, fn: TestFn): Promise<void>;
  function test(name: string, options: TestOptions, fn: TestFn): Promise<void>;

  namespace test {
    function skip(name: string, fn: TestFn): Promise<void>;
    function todo(name: string, fn: TestFn): Promise<void>;
    function only(name: string, fn: TestFn): Promise<void>;
  }

  export default test;
  export { test };
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
  export function before(fn: TestFn): void;
  export function after(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}

declare module 'node:assert/strict' {
  type ErrorLike = RegExp | (new (...args: never[]) => Error) | ((err: unknown) => boolean);

  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    strictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: ErrorLike, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    fail(message?: string): never;
  }

  const assert: Assert;
  export default assert;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding?: 'utf8'): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** `process` is used by scripts/ for exit codes and argv only. */
declare const process: {
  argv: string[];
  exit(code?: number): never;
  stdout: { write(s: string): boolean };
  env: Record<string, string | undefined>;
};
