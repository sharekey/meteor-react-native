// Ambient declarations for modules without published types

declare module '@meteorrn/minimongo' {
  export default class Minimongo {
    [key: string]: any;
    collections: Record<string, any>;
    addCollection(name: string): void;
    on(event: string, cb: (...args: any[]) => void): void;
    off(event: string, cb: (...args: any[]) => void): void;
  }
}

declare module 'ejson' {
  const EJSON: {
    stringify: (v: any) => string;
    parse: (s: string) => any;
    equals: (a: any, b: any) => boolean;
    clone: <T>(v: T) => T;
    addType: (name: string, factory: (str: string) => any) => void;
  };
  export default EJSON;
}

declare module 'react-native/Libraries/Renderer/shims/ReactNative' {
  export const unstable_batchedUpdates: (fn: (...args: any[]) => void) => void;
}
