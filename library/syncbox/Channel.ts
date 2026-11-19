import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { BaseError } from "../../src/errors/BaseError";
import { type Gen, isGenerator, park } from "../../src/runtime/coroutine";
import { runtime } from "../../src/runtime/Runtime";

type ChannelOptions<T> = {
  mode?: "fifo" | "lifo";
  drop?: "oldest" | "newest";
  strict?: boolean;
  replay?: number;
  timeout?: number;
  onSend?: (value: T) => void;
  onRecv?: (value: T | null) => void;
  onClose?: () => void;
  ttl?: number;
};

class Channel<T> {
  private buffer: T[] = [];
  private replayBuffer: T[] = [];
  private sendQueue: { value: T; resolve: (value: any) => void }[] = [];
  private recvQueue: ((value: T | null) => void)[] = [];
  private bufferSize: number;
  private closed = false;
  private options: ChannelOptions<T>;
  private createdAt: number = Date.now();

  constructor(bufferSize = 0, options: ChannelOptions<T> = {}) {
    this.bufferSize = bufferSize;
    this.options = options;
  }

  /**
   * Run a user hook (onSend / onRecv / onClose). Hooks are language functions, i.e.
   * generators: start them as their own task and do not wait for them (fire and forget).
   */
  private fire(hook: ((...args: any[]) => any) | undefined, ...args: any[]): void {
    if (!hook) return;

    const result = hook(...args);

    if (isGenerator(result)) {
      runtime.scheduler.spawn(() => result, {
        name: "channel-hook",
        onError: (error) => console.error("Error in channel hook:", error),
      });
    }
  }

  private isExpired(): boolean {
    if (!this.options.ttl) return false;
    return Date.now() - this.createdAt > this.options.ttl;
  }

  private pushToBuffer(value: T): void {
    if (this.options.mode === "lifo") {
      this.buffer.unshift(value);
    } else {
      this.buffer.push(value);
    }
  }

  /**
   * A receive freed a buffer slot: let the longest-waiting blocked sender put its
   * value into the buffer and wake it up (otherwise it would stay blocked until
   * some later receive happened to drain the queue).
   */
  private promoteSender(): void {
    if (this.sendQueue.length === 0 || this.buffer.length >= this.bufferSize) {
      return;
    }

    const { value, resolve } = this.sendQueue.shift()!;

    this.pushToBuffer(value);
    this.fire(this.options.onSend, value);
    this.storeReplay(value);
    resolve(null);
  }

  private storeReplay(value: T): void {
    if (typeof this.options.replay === "number" && this.options.replay > 0) {
      this.replayBuffer.push(value);
      if (this.replayBuffer.length > this.options.replay) {
        this.replayBuffer.shift();
      }
    }
  }

  replayClear() {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): void {
        if (channel.options.replay) {
          channel.replayBuffer = [];
        }
      }
    };
  }

  getReplay() {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): T[] {
        if (!channel.options.replay) return [];
        return [...channel.replayBuffer];
      }
    };
  }

  close(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): void {
        channel.closed = true;
        channel.recvQueue.forEach((resolve) => resolve(null));
        channel.recvQueue = [];
        channel.sendQueue.forEach(({ resolve }) => resolve(null));
        channel.sendQueue = [];
        channel.fire(channel.options.onClose);
      }
    };
  }

  isClosed(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): boolean {
        return channel.closed;
      }
    };
  }

  len(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): number {
        return channel.buffer.length;
      }
    };
  }

  cap(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): number {
        return channel.bufferSize;
      }
    };
  }

  trySend(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): boolean {
        const [value] = this.args;
        if (channel.closed || channel.isExpired()) return false;

        if (channel.recvQueue.length > 0) {
          const recv = channel.recvQueue.shift()!;
          recv(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return true;
        }

        if (channel.buffer.length < channel.bufferSize) {
          channel.pushToBuffer(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return true;
        }

        if (channel.options.drop === "oldest") {
          channel.buffer.shift();
          channel.pushToBuffer(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return true;
        }

        if (channel.options.drop === "newest") {
          return false;
        }

        return false;
      }
    };
  }

  tryRecv(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      call(): T | null {
        if (channel.replayBuffer.length > 0) {
          const value = channel.replayBuffer[0] ?? null;
          channel.fire(channel.options.onRecv, value);
          return value;
        }

        if (channel.buffer.length > 0) {
          const value = channel.buffer.shift() ?? null;
          channel.promoteSender();
          channel.fire(channel.options.onRecv, value);
          return value;
        }

        if (channel.sendQueue.length > 0) {
          const { value, resolve } = channel.sendQueue.shift()!;
          const valueDefault = value ?? null;

          resolve(valueDefault);
          channel.fire(channel.options.onRecv, valueDefault);
          return valueDefault;
        }

        channel.fire(channel.options.onRecv, null);
        return null;
      }
    };
  }

  send(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      *call(): Gen<any> {
        const [value] = this.args;

        if (channel.closed || channel.isExpired()) {
          throw new BaseError("cannot send on closed or expired channel");
        }

        if (channel.recvQueue.length > 0) {
          const recv = channel.recvQueue.shift()!;
          recv(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return;
        }

        if (channel.buffer.length < channel.bufferSize) {
          channel.pushToBuffer(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return;
        }

        if (channel.options.drop === "oldest") {
          channel.buffer.shift();
          channel.pushToBuffer(value);
          channel.fire(channel.options.onSend, value);
          channel.storeReplay(value);
          return;
        }

        if (channel.options.drop === "newest") {
          return;
        }

        return yield park<any>((wake) => {
          const entry = { value, resolve: wake };
          channel.sendQueue.push(entry);

          return () => {
            const index = channel.sendQueue.indexOf(entry);
            if (index !== -1) channel.sendQueue.splice(index, 1);
          };
        });
      }
    };
  }

  recv(): any {
    const channel = this;
    return class extends FunctionBuilder {
      constructor(args: any[] = [], astArgs: StmtType[] = [], environment: Environment) {
        super(args, astArgs, environment);
      }

      get pkgInfo() {
        return { name: "syncbox", path: __dirname };
      }

      *call(): Gen<T | null> {
        if (channel.replayBuffer.length > 0) {
          const value = channel.replayBuffer[0] ?? null;
          channel.fire(channel.options.onRecv, value);
          return value;
        }

        if (channel.buffer.length > 0) {
          const value = channel.buffer.shift() ?? null;
          channel.promoteSender();
          channel.fire(channel.options.onRecv, value);
          return value;
        }

        if (channel.sendQueue.length > 0) {
          const { value, resolve } = channel.sendQueue.shift()!;
          const valueDefault = value ?? null;

          resolve(valueDefault);
          channel.fire(channel.options.onRecv, valueDefault);
          return valueDefault;
        }

        if (channel.closed || channel.isExpired()) {
          channel.fire(channel.options.onRecv, null);
          return null;
        }

        return yield park<T | null>((wake) => {
          let cancelTimer: (() => void) | null = null;

          const remove = () => {
            const index = channel.recvQueue.indexOf(waiter);
            if (index !== -1) channel.recvQueue.splice(index, 1);
          };

          const waiter = (value: T | null) => {
            cancelTimer?.();
            channel.fire(channel.options.onRecv, value);
            wake(value);
          };

          if (channel.options.timeout) {
            cancelTimer = runtime.scheduler.after(channel.options.timeout, () => {
              remove();
              channel.fire(channel.options.onRecv, null);
              wake(null);
            });
          }

          channel.recvQueue.push(waiter);

          return () => {
            cancelTimer?.();
            remove();
          };
        });
      }
    };
  }
}

export { Channel };
