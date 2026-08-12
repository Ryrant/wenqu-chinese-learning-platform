const normalizeSentence = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function buildTemplateAnswer(prompt, excerpts) {
  const sourceText = excerpts.map(normalizeSentence).filter(Boolean).join(" ");
  if (!sourceText) return "未从已审核来源中找到足够信息，暂时无法回答这个问题。";
  const promptText = normalizeSentence(prompt).replace(/[?？!！。]+$/g, "");
  const sentences = sourceText
    .split(/(?<=[。！？!?])/u)
    .map(normalizeSentence)
    .filter((sentence) => sentence && sentence !== promptText && !sentence.includes(promptText));
  const selected = [...new Set(sentences)].slice(0, 4).join("");
  return (selected || sourceText).slice(0, 600);
}
