export type DialogueGoal = { title: string; expressions: string[]; prompt: string; response: string; hint: string };
export type DialogueContent = { roleName: string; brief: string; opening: string; goals: DialogueGoal[]; aiEnabled: boolean };
export type DialogueScenario = DialogueContent & { id: string; title: string; classId: string; className: string; authorName: string; revision: number; status: "published" | "archived" };
export type PublicDialogueScenario = Omit<DialogueScenario, "goals"> & { goals: Array<{ title: string }> };
export type DialogueTurn = { id: string; kind: "student" | "role" | "hint"; text: string; step: number; at: string; provider?: "script" | "openai" | "fallback"; model?: string; matchedExpression?: string };
export type DialogueSession = { id: string; scenario: PublicDialogueScenario; turns: DialogueTurn[]; step: number; hintCount: number; revision: number; complete: boolean; pending: boolean; canContinue: boolean; studentName: string; createdAt: string };
export type DialogueCatalog = { view: "student" | "teacher"; classes: Array<{ id: string; name: string }>; scenarios: Array<DialogueScenario | PublicDialogueScenario>; sessions: DialogueSession[]; aiConfigured: boolean };

export const dialogueTemplates: Array<{ title: string; content: DialogueContent }> = [
  {
    title: "早餐店点餐", content: { roleName: "早餐店店员", brief: "你要在早餐店买两份包子，每份三元。练习说清需求、询问价格并礼貌结束交流。", opening: "欢迎光临！今天有热包子，每份三元。你想买点什么？", aiEnabled: false, goals: [
      { title: "说清要买的餐点和数量", expressions: ["我要两份包子", "我想买两份包子", "我想要两份包子"], prompt: "你想买什么？需要几份？", response: "好的，两份包子。你还想了解什么？", hint: "可以说：你好，我想买两份包子。" },
      { title: "询问总价", expressions: ["一共多少钱", "总共多少钱", "总价是多少"], prompt: "你可以再问问两份包子一共需要多少钱。", response: "每份三元，两份一共六元。", hint: "可以说：请问，一共多少钱？" },
      { title: "礼貌结束交流", expressions: ["谢谢", "多谢"], prompt: "买好早餐后，可以怎样礼貌地结束交流？", response: "不客气，祝你用餐愉快！", hint: "可以说：好的，谢谢你！" },
    ] },
  },
  {
    title: "图书馆借书", content: { roleName: "图书管理员", brief: "你想借一本故事书。图书馆的故事书在二号书架，每次可以借两周。", opening: "你好，欢迎来到图书馆！你想找什么书？", aiEnabled: false, goals: [
      { title: "说明想借的书", expressions: ["想借一本故事书", "我要借故事书", "想找故事书"], prompt: "请告诉我，你想借什么类型的书？", response: "故事书在二号书架，我可以指给你看。", hint: "可以说：你好，我想借一本故事书。" },
      { title: "询问借阅时间", expressions: ["可以借多久", "能借多长时间", "什么时候还"], prompt: "找到书了，你还可以问问什么时候需要归还。", response: "每次可以借两周，请记得按时归还。", hint: "可以说：请问，这本书可以借多久？" },
      { title: "表达感谢", expressions: ["谢谢", "多谢"], prompt: "管理员帮了你，可以怎样表达感谢？", response: "不客气，祝你阅读愉快！", hint: "可以说：谢谢你的帮助！" },
    ] },
  },
  {
    title: "向同学问路", content: { roleName: "校园里的同学", brief: "你是新同学，想去学校图书馆。图书馆在教学楼旁边，从这里直走后左转就能看到。", opening: "你好！你看起来正在找地方，需要帮忙吗？", aiEnabled: false, goals: [
      { title: "礼貌说明目的地", expressions: ["图书馆怎么走", "图书馆在哪里", "想去图书馆"], prompt: "你想去学校的哪个地方呢？", response: "图书馆在教学楼旁边，从这里直走，再左转就能看到。", hint: "可以说：请问，图书馆怎么走？" },
      { title: "复述并确认路线", expressions: ["直走再左转", "先直走然后左转", "直走然后左转"], prompt: "你可以用自己的话确认一下路线。", response: "对，先直走，再左转。图书馆就在教学楼旁边。", hint: "可以说：是先直走，再左转吗？" },
      { title: "表达感谢", expressions: ["谢谢", "多谢"], prompt: "得到帮助后，记得向同学表达感谢。", response: "不客气，希望你很快找到图书馆！", hint: "可以说：谢谢你，我知道怎么走了！" },
    ] },
  },
];

export function normalizeDialogueText(text: string) { return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
export function matchedDialogueExpression(text: string, goal: DialogueGoal) {
  const normalized = normalizeDialogueText(text);
  return goal.expressions.find((expression) => normalized.includes(normalizeDialogueText(expression))) ?? null;
}
export function publicDialogueScenario(scenario: DialogueScenario): PublicDialogueScenario {
  return { ...scenario, goals: scenario.goals.map((goal) => ({ title: goal.title })) };
}
export function dialogueErrorMessage(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "dialogue_turn_pending") return "上一条发言仍在处理，请稍后重新读取；输入已保留。";
  if (code === "dialogue_session_changed" || code === "dialogue_scenario_changed") return "记录已更新，请重新读取后再操作；当前输入仍保留。";
  if (code === "dialogue_scenario_unavailable") return "这个情境已归档或当前班级权限已变化，已有对话仍可回看。";
  if (code === "invalid_dialogue_turn_limit") return "本轮对话已达到上限，可以保留记录并开始新一轮。";
  if (code.startsWith("invalid_dialogue")) return "请检查情境、表达示例和当前输入是否完整，再重试。";
  return "操作结果尚未确认，请重新读取或用相同内容重试；当前输入已保留。";
}
