import { EventMethodBuilder } from "./EventsBuilder";
import { Environment } from "../../src/Environment";
import { type FunctionBuilder } from "../FunctionBuilder";
import { isTypeArgs } from "../utils/utils";
import { type Gen } from "../../src/runtime/coroutine";

interface IListeners {
  listener: typeof FunctionBuilder;
  priority: number;
  once: boolean;
  passive?: boolean;
  id: string;
}

class EventDispatcher extends EventMethodBuilder {
  override call() {
    const listeners = new Map<string, IListeners[]>();
    const beforeListeners = new Map<string, IListeners[]>();
    const afterListeners = new Map<string, IListeners[]>();
    const propagationStopped = new Set<string>();
    const defaultPrevented = new Set<string>();

    const self: any = {
      addEventListener: class extends EventMethodBuilder {
        override call() {
          const [eventType, listener, options = {}] = this.args;
          this.validateString(eventType);
          this.validateFunction(listener);

          const { priority = 0, once = false, passive = false, capture = false } = options || {};

          const targetMap = capture ? beforeListeners : listeners;

          if (!targetMap.has(eventType)) {
            targetMap.set(eventType, []);
          }

          const eventListeners = targetMap.get(eventType)!;
          eventListeners.push({
            listener,
            priority,
            once,
            passive,
            id: `${eventType}_${Date.now()}_${Math.random()}`,
          });

          eventListeners.sort((a, b) => b.priority - a.priority);
          return self;
        }
      },

      removeEventListener: class extends EventMethodBuilder {
        override call() {
          const [eventType, listener, options = {}] = this.args;
          this.validateString(eventType);
          this.validateFunction(listener);

          const { capture = false } = options;
          const targetMap = capture ? beforeListeners : listeners;

          if (!targetMap.has(eventType)) {
            return self;
          }

          const eventListeners = targetMap.get(eventType)!;
          const index = eventListeners.findIndex((l) => l.listener === listener);

          if (index !== -1) {
            eventListeners.splice(index, 1);
          }

          return self;
        }
      },

      dispatchEvent: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          const [event] = this.args;

          // `preventDefault()` / `stopPropagation()` must be callable from the
          // language, which only invokes method classes, not host arrow functions.
          const method = (action: () => void) =>
            class extends EventMethodBuilder {
              override call() {
                action();
              }
            };

          const buildEvent = (type: string, extra: Record<string, any>) => {
            const eventObj: any = {
              bubbles: false,
              cancelable: false,
              ...extra,
              type,
              target: self,
              currentTarget: self,
              defaultPrevented: false,
              timeStamp: Date.now(),
            };

            eventObj.preventDefault = method(() => {
              if (eventObj.cancelable) {
                eventObj.defaultPrevented = true;
                defaultPrevented.add(type);
              }
            });
            eventObj.stopPropagation = method(() => {
              propagationStopped.add(type);
            });

            return eventObj;
          };

          if (isTypeArgs(event) === "string") {
            return yield this.processEvent(buildEvent(event, {}));
          } else if (isTypeArgs(event) === "object" && event.type) {
            return yield this.processEvent(buildEvent(event.type, event));
          } else {
            throw this.throwErrorFormatters(
              new Error("Event must be a string or event object with type property"),
            );
          }
        }

        private *processEvent(eventObj: any): Gen<any> {
          const eventType = eventObj.type;

          if (beforeListeners.has(eventType)) {
            const beforeList = beforeListeners.get(eventType)!;
            yield this.executePhaseListeners(beforeList, eventObj, eventType);
          }

          if (propagationStopped.has(eventType)) {
            propagationStopped.delete(eventType);
            return !eventObj.defaultPrevented;
          }

          if (listeners.has(eventType)) {
            const mainList = listeners.get(eventType)!;
            yield this.executePhaseListeners(mainList, eventObj, eventType);
          }

          if (propagationStopped.has(eventType)) {
            propagationStopped.delete(eventType);
            return !eventObj.defaultPrevented;
          }

          if (afterListeners.has(eventType)) {
            const afterList = afterListeners.get(eventType)!;
            yield this.executePhaseListeners(afterList, eventObj, eventType);
          }

          propagationStopped.delete(eventType);
          const wasDefaultPrevented = defaultPrevented.has(eventType);
          defaultPrevented.delete(eventType);

          return !wasDefaultPrevented;
        }

        private *executePhaseListeners(
          listenerList: any[],
          eventObj: any,
          eventType: string,
        ): Gen<any> {
          for (const entry of [...listenerList]) {
            const { listener, once, passive } = entry;

            if (propagationStopped.has(eventType)) {
              break;
            }

            if (once) {
              const index = listenerList.indexOf(entry);

              if (index !== -1) {
                listenerList.splice(index, 1);
              }
            }

            try {
              if (!passive) {
                yield this.executeListener(listener, [eventObj]);
              } else {
                const passiveEvent = { ...eventObj };
                delete passiveEvent.preventDefault;
                delete passiveEvent.stopPropagation;
                yield this.executeListener(listener, [passiveEvent]);
              }
            } catch (error) {
              console.error(`Error in event listener for ${eventType}:`, error);
            }
          }
        }
      },

      addAfterListener: class extends EventMethodBuilder {
        override call() {
          const [eventType, listener, options = {}] = this.args;
          this.validateString(eventType);
          this.validateFunction(listener);

          const { priority = 0, once = false } = options;

          if (!afterListeners.has(eventType)) {
            afterListeners.set(eventType, []);
          }

          const eventListeners = afterListeners.get(eventType)!;
          eventListeners.push({
            listener,
            priority,
            once,
            id: `${eventType}_after_${Date.now()}_${Math.random()}`,
          });

          eventListeners.sort((a, b) => b.priority - a.priority);
          return self;
        }
      },

      hasEventListener: class extends EventMethodBuilder {
        override call() {
          const [eventType, listener] = this.args;
          this.validateString(eventType);

          if (listener) {
            this.validateFunction(listener);

            const checkInMap = (map: Map<string, any[]>) => {
              if (!map.has(eventType)) return false;
              return map.get(eventType)!.some((l) => l.listener === listener);
            };

            return (
              checkInMap(listeners) || checkInMap(beforeListeners) || checkInMap(afterListeners)
            );
          }

          return (
            listeners.has(eventType) ||
            beforeListeners.has(eventType) ||
            afterListeners.has(eventType)
          );
        }
      },

      getEventListeners: class extends EventMethodBuilder {
        override call() {
          const [eventType] = this.args;
          this.validateString(eventType);

          const result = {
            capture: beforeListeners.has(eventType)
              ? beforeListeners.get(eventType)!.map((l) => l.listener)
              : [],
            target: listeners.has(eventType)
              ? listeners.get(eventType)!.map((l) => l.listener)
              : [],
            bubble: afterListeners.has(eventType)
              ? afterListeners.get(eventType)!.map((l) => l.listener)
              : [],
          };

          return result;
        }
      },

      clearEventListeners: class extends EventMethodBuilder {
        override call() {
          const [eventType] = this.args;

          if (eventType) {
            this.validateString(eventType);
            listeners.delete(eventType);
            beforeListeners.delete(eventType);
            afterListeners.delete(eventType);
          } else {
            listeners.clear();
            beforeListeners.clear();
            afterListeners.clear();
          }

          return self;
        }
      },

      getEventTypes: class extends EventMethodBuilder {
        override call() {
          const types = new Set([
            ...listeners.keys(),
            ...beforeListeners.keys(),
            ...afterListeners.keys(),
          ]);

          return Array.from(types);
        }
      },

      [Environment.SymbolFormatedText]: `EventDispatcher { events: ${listeners.size + beforeListeners.size + afterListeners.size} }`,
    };

    return self;
  }
}

export { EventDispatcher };
