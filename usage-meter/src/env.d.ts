// esbuild loads .css imports as plain text (see build.mjs), injected into the shadow root.
declare module "*.css" {
  const text: string;
  export default text;
}
