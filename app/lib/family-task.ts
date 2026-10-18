export type BilingualText = { zh: string; en: string };
export type ExchangePartner = "family" | "peer" | "teacher";
export const EXCHANGE_PARTNERS: Record<ExchangePartner, BilingualText> = {
  family: { zh: "家人", en: "Family member" }, peer: { zh: "同伴", en: "Peer" }, teacher: { zh: "教师", en: "Teacher" },
};
export const FAMILY_HELP_EN: Record<string, string> = { independent: "Completed independently", prompted: "Received prompts", assisted: "Worked together / substantial help" };
export const FAMILY_EXCHANGE_RUBRIC = [{ name: "提问切题", weight: 30 }, { name: "追问与倾听", weight: 30 }, { name: "复述与表达", weight: 40 }];
export type FamilyTemplate = {
  id: string; title: BilingualText; steps: BilingualText[];
  questions: Array<{ ask: BilingualText; followUp: BilingualText }>; stems: BilingualText[]; work: BilingualText;
};
const bilingual = (zh: string, en: string): BilingualText => ({ zh, en });
export const FAMILY_TASK_TEMPLATES: FamilyTemplate[] = [
  {
    id: "home-dish", title: bilingual("采访一道家常菜", "Interview about a home-style dish"),
    steps: [bilingual("约一位家人、同伴或老师，选一道对方熟悉的菜，先准备两个问题。", "Choose a familiar dish and prepare two questions for a family member, peer or teacher."),
      bilingual("听对方介绍食材和做法，用关键词记录，不让对方代写总结。", "Listen to the ingredients and method. Take keyword notes and write your own summary."),
      bilingual("选一个不清楚或有意思的细节继续追问，再复述给对方核对。", "Ask a follow-up about an unclear or interesting detail, then retell it for your partner to check."),
      bilingual("用自己的中文提交总结，并记录这次实际使用的提示。", "Submit a summary in your own Chinese and report the prompts you actually used.")],
    questions: [
      { ask: bilingual("这道菜需要哪些食材？", "What ingredients does this dish need?"), followUp: bilingual("如果少一种食材，可以怎样替换？", "What could replace a missing ingredient?") },
      { ask: bilingual("先做什么，再做什么？", "What do you do first, and next?"), followUp: bilingual("为什么这一步要这样做？", "Why is this step done this way?") },
      { ask: bilingual("你为什么喜欢这道菜？", "Why do you like this dish?"), followUp: bilingual("它让你想起什么人或经历？", "Does it remind you of a person or experience?") },
    ],
    stems: [bilingual("我想了解……", "I would like to learn about …"), bilingual("你刚才说……，能再说说……吗？", "You mentioned … Could you tell me more about …?"), bilingual("我听到的做法是先……再……，我推荐它，因为……", "The method I heard was first … then … I recommend it because …")],
    work: bilingual("提交自己的录音或文字：写明一个实际问题、一个追问，再复述做法并说明推荐理由。", "Submit your own audio or text: include one question you asked, one follow-up, the method and a reason to recommend the dish."),
  },
  {
    id: "festival-memory", title: bilingual("采访一段节日记忆", "Interview about a festival memory"),
    steps: [bilingual("选一个对方亲历的节日，请对方讲一段具体经历。", "Choose a festival your partner has experienced and ask for one specific memory."),
      bilingual("记录人物、活动和一处细节，分清对方的经历与自己的想法。", "Note the people, activities and one detail. Distinguish your partner's experience from your own ideas."),
      bilingual("围绕原因或变化追问一次，再用自己的话复述并核对。", "Ask one follow-up about a reason or change, then retell the memory and check your understanding."),
      bilingual("整理成自己的录音或文字，说明一处相同或不同。", "Create your own audio or text summary and explain one similarity or difference.")],
    questions: [
      { ask: bilingual("你记得的那次节日是怎样过的？", "How did you celebrate that festival?"), followUp: bilingual("当时谁在场，哪件事最难忘？", "Who was there, and what stood out?") },
      { ask: bilingual("你们为什么会做这件事？", "Why did you do that activity?"), followUp: bilingual("这个做法对你有什么意义？", "What does that custom mean to you?") },
      { ask: bilingual("现在和以前有什么不同？", "What is different now?"), followUp: bilingual("你希望保留哪一部分，为什么？", "Which part would you like to keep, and why?") },
    ],
    stems: [bilingual("我采访的经历发生在……", "The experience I asked about happened …"), bilingual("你提到……，当时为什么……？", "You mentioned … Why did … happen then?"), bilingual("对方说……；和我的经历相比……", "My partner said … Compared with my experience …")],
    work: bilingual("提交一个实际问题、一个追问，以及自己的节日故事复述和一处比较。", "Submit one question, one follow-up, your retelling of the memory and one comparison."),
  },
  {
    id: "daily-choice", title: bilingual("交流一次日常选择", "Talk about an everyday choice"),
    steps: [bilingual("和交流对象选一个小决定，如周末活动、一道午餐或一种出行方式。", "Choose a small decision together, such as a weekend activity, lunch or a way to travel."),
      bilingual("先听对方提出选择和理由，用关键词记录两种可能。", "Listen to your partner's options and reasons. Note two possibilities using keywords."),
      bilingual("追问一个条件，再表达自己的选择和理由，允许意见不同。", "Ask about one condition, then explain your own choice and reason. You may disagree."),
      bilingual("复述双方理由，并提交自己整理的录音或文字。", "Retell both sets of reasons and submit your own audio or text summary.")],
    questions: [
      { ask: bilingual("你会选哪一种，为什么？", "Which option would you choose, and why?"), followUp: bilingual("哪一个原因对你最重要？", "Which reason matters most to you?") },
      { ask: bilingual("另一种选择有什么好处？", "What is good about the other option?"), followUp: bilingual("在什么情况下你会改变选择？", "What would make you change your choice?") },
      { ask: bilingual("我们怎样一起作决定？", "How could we decide together?"), followUp: bilingual("如果意见不同，可以怎样商量？", "How could we discuss different preferences?") },
    ],
    stems: [bilingual("你选择……，因为……，我理解得对吗？", "You chose … because … Did I understand correctly?"), bilingual("如果……，你还会……吗？", "If …, would you still …?"), bilingual("我更想……，理由是……；我们可以……", "I would prefer … because … We could …")],
    work: bilingual("提交一个实际问题、一个追问、双方理由的复述，以及自己的选择；说明用了哪些帮助。", "Submit one question, one follow-up, a retelling of both reasons and your own choice. Explain any help you used."),
  },
];
export type FamilyPlan = { version: 1; revision: number; partner: ExchangePartner; template: FamilyTemplate | null };
export type FamilyWorkSnapshot = { version: 1; title: string; detail: string; objectiveId: string; objectiveTitle: string; partner: ExchangePartner; plan: FamilyPlan | null; rubric: Array<{ name: string; weight: number }> };
export function exchangePartner(value: unknown): ExchangePartner {
  if (value !== "family" && value !== "peer" && value !== "teacher") throw new Error("invalid_exchange_partner");
  return value;
}
export function createFamilyPlan(templateId = "", partner: string = "family"): FamilyPlan {
  const template = FAMILY_TASK_TEMPLATES.find((item) => item.id === templateId) ?? null;
  if (templateId && !template) throw new Error("invalid_family_template");
  return { version: 1, revision: 1, partner: exchangePartner(partner), template };
}
function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const isBilingual = (value: unknown) => { const item = jsonObject(value); return !!item && typeof item.zh === "string" && typeof item.en === "string"; };
export function readFamilyPlan(value: unknown): FamilyPlan | null {
  const item = jsonObject(value);
  if (!item || item.version !== 1 || !Number.isInteger(item.revision) || Number(item.revision) < 1 || !Object.hasOwn(EXCHANGE_PARTNERS, String(item.partner))) return null;
  const template = jsonObject(item.template);
  if (item.template !== null && (!template || typeof template.id !== "string" || !isBilingual(template.title) || !isBilingual(template.work)
    || !Array.isArray(template.steps) || !template.steps.every(isBilingual) || !Array.isArray(template.stems) || !template.stems.every(isBilingual)
    || !Array.isArray(template.questions) || !template.questions.every((value) => { const question = jsonObject(value); return !!question && isBilingual(question.ask) && isBilingual(question.followUp); }))) return null;
  return item as FamilyPlan;
}
export function readFamilyWorkSnapshot(value: unknown): FamilyWorkSnapshot | null {
  const item = jsonObject(value);
  if (!item || item.version !== 1 || !["title", "detail", "objectiveId", "objectiveTitle"].every((key) => typeof item[key] === "string")
    || !Object.hasOwn(EXCHANGE_PARTNERS, String(item.partner)) || (item.plan !== null && !readFamilyPlan(item.plan))
    || !Array.isArray(item.rubric) || !item.rubric.every((value) => { const dimension = jsonObject(value); return !!dimension && typeof dimension.name === "string" && Number.isFinite(dimension.weight); })) return null;
  return item as FamilyWorkSnapshot;
}
