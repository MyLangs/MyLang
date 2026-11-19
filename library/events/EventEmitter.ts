import { EventMethodBuilder } from "./EventsBuilder";
import { Environment } from "../../src/Environment";
import { type FunctionBuilder } from "../FunctionBuilder";
import { type Gen } from "../../src/runtime/coroutine";

interface IListeners {
  listener: typeof FunctionBuilder;
  once: boolean;
  prepend: boolean;
}

class EventEmitter extends EventMethodBuilder {
  override call() {
    const events = new Map<string, IListeners[]>();
    const maxListeners = { value: 10 };
    let captureRejections = false;

    const self: any = {
      on: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);
          this.validateFunction(listener);

          if (!events.has(eventName)) {
            events.set(eventName, []);
          }

          const listeners = events.get(eventName)!;

          if (listeners.length >= maxListeners.value && maxListeners.value > 0) {
            console.warn(
              `Possible EventEmitter memory leak detected. ${listeners.length + 1} ${eventName} listeners added. Use setMaxListeners() to increase limit.`,
            );
          }

          listeners.push({ listener, once: false, prepend: false });
          return self;
        }
      },

      once: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);
          this.validateFunction(listener);

          if (!events.has(eventName)) {
            events.set(eventName, []);
          }

          const listeners = events.get(eventName)!;
          listeners.push({ listener, once: true, prepend: false });
          return self;
        }
      },

      emit: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          const [eventName, ...args] = this.args;
          this.validateString(eventName);

          if (!events.has(eventName)) {
            return false;
          }

          const listeners = events.get(eventName)!;
          if (listeners.length === 0) {
            return false;
          }

          // Iterate a snapshot (a listener may add or remove listeners while the
          // event is being emitted) and drop `once` listeners before they run.
          for (const entry of [...listeners]) {
            const { listener, once } = entry;

            if (once) {
              const index = listeners.indexOf(entry);

              if (index !== -1) {
                listeners.splice(index, 1);
              }
            }

            try {
              yield this.executeListener(listener, args);
            } catch (error) {
              if (captureRejections && events.has("error")) {
                yield this.executeListener(events.get("error")![0]?.listener, [error]);
              } else {
                throw error;
              }
            }
          }

          return true;
        }
      },

      off: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);

          if (listener) {
            this.validateFunction(listener);
          }

          if (!events.has(eventName)) {
            return self;
          }

          const listeners = events.get(eventName)!;

          if (listener) {
            const index = listeners.findIndex((l) => l.listener === listener);
            if (index !== -1) {
              listeners.splice(index, 1);
            }
          } else {
            listeners.length = 0;
          }

          return self;
        }
      },

      removeListener: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);
          this.validateFunction(listener);

          if (!events.has(eventName)) {
            return self;
          }

          const listeners = events.get(eventName)!;
          const index = listeners.findIndex((l) => l.listener === listener);

          if (index !== -1) {
            listeners.splice(index, 1);
          }

          return self;
        }
      },

      removeAllListeners: class extends EventMethodBuilder {
        override call() {
          const [eventName] = this.args;

          if (eventName) {
            this.validateString(eventName);
            if (events.has(eventName)) {
              events.get(eventName)!.length = 0;
            }
          } else {
            events.clear();
          }

          return self;
        }
      },

      setMaxListeners: class extends EventMethodBuilder {
        override call() {
          const [n] = this.args;
          this.validateNumber(n, "maxListeners");

          maxListeners.value = n;
          return self;
        }
      },

      getMaxListeners: class extends EventMethodBuilder {
        override call() {
          return maxListeners.value;
        }
      },

      listeners: class extends EventMethodBuilder {
        override call() {
          const [eventName] = this.args;
          this.validateString(eventName);

          if (!events.has(eventName)) {
            return [];
          }

          return events.get(eventName)!.map((l) => l.listener);
        }
      },

      listenerCount: class extends EventMethodBuilder {
        override call() {
          const [eventName] = this.args;
          this.validateString(eventName);

          return events.has(eventName) ? events.get(eventName)!.length : 0;
        }
      },

      eventNames: class extends EventMethodBuilder {
        override call() {
          // events whose listeners were all removed (or were `once`) are not listed
          return Array.from(events.entries())
            .filter(([, listeners]) => listeners.length > 0)
            .map(([name]) => name);
        }
      },

      prependListener: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);
          this.validateFunction(listener);

          if (!events.has(eventName)) {
            events.set(eventName, []);
          }

          const listeners = events.get(eventName)!;
          listeners.unshift({ listener, once: false, prepend: true });
          return self;
        }
      },

      prependOnceListener: class extends EventMethodBuilder {
        override call() {
          const [eventName, listener] = this.args;
          this.validateString(eventName);
          this.validateFunction(listener);

          if (!events.has(eventName)) {
            events.set(eventName, []);
          }

          const listeners = events.get(eventName)!;
          listeners.unshift({ listener, once: true, prepend: true });
          return self;
        }
      },

      rawListeners: class extends EventMethodBuilder {
        override call() {
          const [eventName] = this.args;
          this.validateString(eventName);

          if (!events.has(eventName)) {
            return [];
          }

          return events.get(eventName)!.map((l) => l.listener);
        }
      },

      [Environment.SymbolEvents]: events,

      [Environment.SymbolCaptureRejections]: captureRejections,

      [Environment.SymbolFormatedText]: `EventEmitter { events: ${events.size}, maxListeners: ${maxListeners.value} }`,
    };

    return self;
  }
}

export { EventEmitter };
