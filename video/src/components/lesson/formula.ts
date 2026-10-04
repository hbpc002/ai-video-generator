// 公式处理：Unicode 归一化 + term-by-term 切分。
//
// 刻意不引 KaTeX —— 第一版只需要撑住 a²+b²=c² 这类常见式子，
// 且不能因为缺字体/缺包就让整条流水线崩。归一化层留好接口，
// 之后要换 KaTeX 只需改 normalizeFormula 的返回。

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "n": "ⁿ", "i": "ⁱ",
};

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ",
  theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ",
  sigma: "σ", phi: "φ", omega: "ω",
  Delta: "Δ", Sigma: "Σ", Omega: "Ω", Pi: "Π",
};

/** a^2 -> a²，sqrt(x) -> √(x)，alpha -> α */
export const normalizeFormula = (raw: string): string => {
  let s = raw.trim();

  s = s.replace(/\^(-?\w+)/g, (_m, exp: string) => {
    return exp
      .split("")
      .map((c) => SUPERSCRIPT[c] ?? c)
      .join("");
  });

  s = s.replace(/\bsqrt\(([^)]+)\)/g, "√($1)");
  s = s.replace(/\bsqrt(\w+)/g, "√$1");

  s = s.replace(/\b(frac)\s*\{(.+?)\}\s*\{(.+?)\}/g, "$2/$3");

  s = s.replace(/\\[a-zA-Z]+/g, "");          // 丢掉 \frac \cdot 之类残留命令
  s = s.replace(/[{}]/g, "");

  for (const [name, glyph] of Object.entries(GREEK)) {
    s = s.replace(new RegExp(`\\b${name}\\b`, "g"), glyph);
  }

  return s.replace(/\s+/g, " ").trim();
};

/**
 * term-by-term 切分：把 a²+b²=c² 切成 ["a²", "+b²", "=c²"]。
 * 保留运算符前缀，逐项浮现时读起来是自然的书写顺序。
 */
export const splitTerms = (formula: string): string[] => {
  const out: string[] = [];
  let buf = "";

  for (const ch of formula) {
    if ((ch === "+" || ch === "-" || ch === "=") && buf.trim().length > 0) {
      out.push(buf.trim());
      buf = "";
      out.push(ch);
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) out.push(buf.trim());

  // 运算符后面如果直接是下一个操作数，合并成一项，避免逐字动画过于碎
  const merged: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (cur.length === 1 && "+-=".includes(cur) && merged.length > 0) {
      merged[merged.length - 1] += cur;
    } else {
      merged.push(cur);
    }
  }
  return merged.filter((t) => t.length > 0);
};

/** 希腊字母/运算符映射回显示文本，供 highlight target 用 */
export const termIndexOf = (terms: string[], needle: string): number => {
  const target = normalizeFormula(needle);
  return terms.findIndex((t) => t.includes(target) || target.includes(t));
};