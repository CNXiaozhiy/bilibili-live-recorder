const colors = {
  bright: "\x1B[1m", // 亮色
  grey: "\x1B[2m", // 灰色
  italic: "\x1B[3m", // 斜体
  underline: "\x1B[4m", // 下划线
  reverse: "\x1B[7m", // 反向
  hidden: "\x1B[8m", // 隐藏
  black: "\x1B[30m", // 黑色
  red: "\x1B[31m", // 红色
  brightRed: "\x1b[31;1m", // 亮红色
  green: "\x1B[32m", // 绿色
  yellow: "\x1B[33m", // 黄色
  blue: "\x1B[34m", // 蓝色
  magenta: "\x1B[35m", // 品红
  cyan: "\x1B[36m", // 青色
  white: "\x1B[37m", // 白色
  blackBG: "\x1B[40m", // 背景色为黑色
  redBG: "\x1B[41m", // 背景色为红色
  whiteRed: "\x1b[37;41m", // 白底红字
  greenBG: "\x1B[42m", // 背景色为绿色
  yellowBG: "\x1B[43m", // 背景色为黄色
  blueBG: "\x1B[44m", // 背景色为蓝色
  magentaBG: "\x1B[45m", // 背景色为品红
  cyanBG: "\x1B[46m", // 背景色为青色
  whiteBG: "\x1B[47m", // 背景色为白色
};
const colorMap = new Map(Object.entries(colors));

export type colors = keyof typeof colors;
export function colorize(...args: [colors, string][]): string;
export function colorize(color: colors, str: string): string;

export function colorize(...options: any): string {
  if (options.length === 2 && typeof options[0] === "string" && typeof options[1] === "string") {
    const [color, str] = options;
    const colorCode = colorMap.get(color) || "";
    return `${colorCode}${str}\x1B[0m`;
  } else if (
    Array.isArray(options) &&
    options.every((arg) => Array.isArray(arg) && arg.length === 2)
  ) {
    return options
      .map(([color, str]) => {
        const colorCode = colorMap.get(color) || "";
        return `${colorCode}${str}\x1B[0m`;
      })
      .join("");
  }
  throw new Error("Invalid arguments");
}

type TextPattern = string;
type RegexPattern = RegExp;
type MatchResult = { [key: string]: string } | string[];

type Callback = (result: MatchResult) => void;

export function matchCommand(input: string, patterns: TextPattern[], callback: Callback): void;
export function matchCommand(input: string, patterns: RegexPattern[], callback: Callback): void;
export function matchCommand(
  input: string,
  patterns: TextPattern[] | RegexPattern[],
  callback: Callback
): void {
  if (patterns.length === 0) return;

  if (typeof patterns[0] === "string") {
    // 处理文本格式匹配
    const textPatterns = patterns as TextPattern[];
    for (const pattern of textPatterns) {
      const regexPattern = convertTextPatternToRegex(pattern);
      const match = input.match(regexPattern);
      if (match) {
        const result = extractMatchResult(pattern, match);
        if (callback instanceof Function) callback(result);
        return;
      }
    }
  } else {
    // 处理正则表达式匹配
    const regexPatterns = patterns as RegexPattern[];
    for (const pattern of regexPatterns) {
      const match = input.match(pattern);
      if (match) {
        if (callback instanceof Function) callback(match.slice(1)); // 去掉第一个元素（整个匹配的字符串）
        return;
      }
    }
  }
}

function convertTextPatternToRegex(pattern: TextPattern): RegExp {
  const regexPattern = pattern.replace(/\{\{(\w+)\}\}/g, "(\\S+)");
  // if (regexPattern.length === 0) return new RegExp(`^${pattern}$`);
  return new RegExp(`^${regexPattern}$`);
}

function extractMatchResult(
  pattern: TextPattern,
  match: RegExpMatchArray
): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  const variableNames = [...pattern.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  variableNames.forEach((name, index) => {
    result[name] = match[index + 1];
  });
  return result;
}
