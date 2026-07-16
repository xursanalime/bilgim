declare module 'dotenv' {
  export interface DotenvConfigOptions {
    path?: string;
    encoding?: string;
    debug?: boolean;
  }

  export interface DotenvParseOutput {
    [name: string]: string;
  }

  export function config(options?: DotenvConfigOptions): { parsed?: DotenvParseOutput };
  export function parse(src: string | Buffer): DotenvParseOutput;
}
