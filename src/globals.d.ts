// Globals provided by the build and the host page (type checking only)
declare const __WORKER_SRC__: string | undefined; // build.mjs inlines the worker bundle
declare const __LAYOUT_SRC__: string | undefined; // раскладка в фоновом потоке
interface Window {
  __app: any; // app handle for e2e and debugging
  claude?: { use(ns: string): Promise<any> }; // Claude artifact runtime
}
