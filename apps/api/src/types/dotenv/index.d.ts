declare module 'dotenv' {
  interface DotenvParseOptions {
    /** path to the env file */
    path?: string;
    /** encoding of the file */
    encoding?: string;
  }

  interface DotenvParseOutput {
    [name: string]: string;
  }

  export function config(options?: DotenvParseOptions): { parsed?: DotenvParseOutput };
  export function parse(src: string | Buffer): DotenvParseOutput;

  export = { config, parse } as any;
}
