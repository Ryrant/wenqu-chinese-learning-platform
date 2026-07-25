"use client";

import { useState } from "react";
import type { Notify } from "./dashboard";
import { ProgressRing } from "./student-view";

const metrics = {
  teacher: [["本周学习完成率","81%","较上周 +7%","green"],["待批阅作业","12","3 项需优先处理","orange"],["班级平均掌握度","76","目标 80 分","blue"],["需要关注","5","连续两周未达标","red"]],
  admin: [["活跃学生","1,284","本月 +8.4%","green"],["教师账号","68","本周活跃 61","blue"],["知识片段","12,680","已审核 96.2%","orange"],["AI 调用额度","72%","剩余 286 万 tokens","purple"]],
};

function MetricGrid({ kind }: { kind: keyof typeof metrics }) {
  return <section className="metric-grid">{metrics[kind].map(([label,value,note,tone])=><article className={`metric-card ${tone}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>;
}

export function TeacherView({ notify }: { notify: Notify }) {
  const [generating,setGenerating]=useState(false);
  const [draft,setDraft]=useState(false);
  function generate(){setGenerating(true);setDraft(false);window.setTimeout(()=>{setGenerating(false);setDraft(true)},1400)}
  return <>
    <section className="welcome-row"><div><span className="eyebrow">南洋华文学校 · 四年级乙班</span><h1>教学总览</h1><p>36 名学生中，29 人已完成本周学习任务。</p></div><button type="button" className="primary-button" onClick={generate}>✦ AI 快速备课</button></section>
    <MetricGrid kind="teacher"/>
    <section className="teacher-grid">
      <article className="panel lesson-builder"><div className="panel-heading"><div><span className="eyebrow">AI 备课助手</span><h3>生成一节有趣的华文课</h3></div><span className="safe-chip">内容需教师审核</span></div><div className="builder-form"><label>主题<input defaultValue="中秋节与团圆"/></label><div className="field-row"><label>水平<select defaultValue="A2"><option>A1</option><option>A2</option><option>B1</option></select></label><label>课时<select defaultValue="40"><option>30 分钟</option><option value="40">40 分钟</option><option>60 分钟</option></select></label></div><label>教学重点<div className="token-input"><span>口语表达 ×</span><span>文化理解 ×</span><button type="button">＋</button></div></label><button type="button" className="primary-button wide" onClick={generate} disabled={generating}>{generating?"正在检索知识库…":"✦ 生成教案草稿"}</button></div>{draft&&<div className="draft-result"><div><span>稿</span><p><strong>《月饼里的团圆》互动课</strong><small>4 个教学环节 · 8 份知识来源 · 40 分钟</small></p></div><button type="button" onClick={()=>notify("已送入审核","教案通过内容审核后即可发布到班级。")}>预览并审核 →</button></div>}</article>
      <article className="panel class-pulse"><div className="panel-heading"><div><span className="eyebrow">班级脉搏</span><h3>本周掌握度</h3></div><button type="button">查看全班 →</button></div><div className="mastery-chart">{[72,84,61,78,88].map((h,i)=><div key={h}><span style={{height:`${h}%`}}/><small>{["听","说","读","写","文化"][i]}</small></div>)}</div><div className="attention-list">{[["语","林小语","口语表达提升明显","+12"],["浩","王文浩","“zh / z”仍需巩固","关注"],["琪","陈雅琪","连续 3 天未完成任务","提醒"]].map(x=><div key={x[1]}><span className="avatar student">{x[0]}</span><p><strong>{x[1]}</strong><small>{x[2]}</small></p><b className={x[3].startsWith("+")?"positive":"attention"}>{x[3]}</b></div>)}</div></article>
    </section>
    <article className="panel assignment-table"><div className="panel-heading"><div><span className="eyebrow">近期任务</span><h3>作业与课堂活动</h3></div><button type="button" onClick={()=>notify("新任务草稿已创建","可以从知识库选择内容并设置学习目标。")}>＋ 创建任务</button></div><div className="table-wrap"><table><thead><tr><th>任务</th><th>班级</th><th>截止时间</th><th>完成情况</th><th>状态</th></tr></thead><tbody><tr><td><b>月饼里的团圆</b><small>故事闯关 · 口语</small></td><td>四年级乙班</td><td>7月28日</td><td><span className="mini-progress"><i style={{width:"81%"}}/></span> 29/36</td><td><span className="status published">进行中</span></td></tr><tr><td><b>我的家乡味道</b><small>看图说话 · 写作</small></td><td>五年级甲班</td><td>7月30日</td><td><span className="mini-progress"><i style={{width:"45%"}}/></span> 14/31</td><td><span className="status published">进行中</span></td></tr><tr><td><b>校园里的一天</b><small>情境对话 · 听力</small></td><td>四年级乙班</td><td>—</td><td>尚未发布</td><td><span className="status draft">待审核</span></td></tr></tbody></table></div></article>
  </>;
}

export function GuardianView({ notify }: { notify: Notify }) {
  const bars=[42,60,51,76,68,88,72];
  return <>
    <section className="welcome-row"><div><span className="eyebrow">林小语 · 本周成长报告</span><h1>她正在更自信地开口</h1><p>本周主动完成 6 次口语练习，表达完整度提高了 12%。</p></div><span className="report-period">7月20日—7月26日</span></section>
    <section className="guardian-hero"><div><span className="eyebrow">本周亮点</span><h2>“我敢用中文讲故事了！”</h2><p>小语在《月饼里的团圆》中完整讲述了一段 42 秒的故事，比上周多使用了 6 个新词。</p><button type="button" className="soft-button" onClick={()=>notify("成长片段准备中","老师审核后，你可以在这里听到孩子的作品。")}>听她的故事 ▶</button></div><ProgressRing value={86} label="学习投入"/></section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">学习时长</span><h3>本周 128 分钟</h3></div><span className="positive">+18%</span></div><div className="week-chart">{bars.map((h,i)=><div key={i}><span style={{height:`${h}%`}} className={i===5?"peak":""}/><small>{["一","二","三","四","五","六","日"][i]}</small></div>)}</div></article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">能力成长</span><h3>优势与下一步</h3></div></div><div className="skill-list">{[["口语表达",84],["听力理解",78],["汉字书写",63],["文化理解",88]].map(([name,value])=><div key={name}><span>{name}</span><i><b style={{width:`${value}%`}}/></i><strong>{value}</strong></div>)}</div></article></section>
    <article className="panel family-task"><div className="family-symbol">家</div><div><span className="eyebrow">本周家庭小任务 · 约 10 分钟</span><h3>一起找找家里的“团圆味道”</h3><p>和孩子选一道家人常吃的食物，请她用“我们一家人喜欢……”说一句完整的话。</p></div><button type="button" className="primary-button" onClick={()=>notify("任务已加入日历","周日晚 7:30 提醒你和小语一起完成。")}>加入家庭日历</button></article>
  </>;
}

export function AdminView({ notify }: { notify: Notify }) {
  return <>
    <section className="welcome-row"><div><span className="eyebrow">南洋华文学校 · 机构工作台</span><h1>平台运行稳健</h1><p>内容、教学与模型服务均处于正常状态。</p></div><button type="button" className="primary-button" onClick={()=>notify("成员邀请已创建","邀请链接将在 24 小时后失效。")}>＋ 邀请成员</button></section>
    <MetricGrid kind="admin"/>
    <section className="admin-grid"><article className="panel knowledge-pipeline"><div className="panel-heading"><div><span className="eyebrow">内容治理</span><h3>知识库发布管线</h3></div><button type="button" onClick={()=>notify("正在校验资料","系统将检查文件类型、权属与重复内容。")}>＋ 上传资料</button></div><div className="pipeline">{[["24","已上传"],["21","已清洗"],["3","待审核"],["18","已发布"]].map((x,i)=><div className={i<2?"complete":i===2?"active":""} key={x[1]}><span>{x[0]}</span><strong>{x[1]}</strong><small>{["文件与素材","结构化完成","专家确认","线上可检索"][i]}</small></div>)}</div><div className="source-list">{[["教","四年级华文教材 · 下册","教材 · 238 个知识片段","已发布"],["文","中华节日文化故事集","自编内容 · 86 个知识片段","已发布"],["访","华文教师访谈纪要","访谈 · 41 个片段 · 需脱敏","待审核"]].map((x,i)=><div key={x[1]}><span className={`file-mark n${i}`}>{x[0]}</span><p><strong>{x[1]}</strong><small>{x[2]}</small></p><span className={`status ${i===2?"draft":"published"}`}>{x[3]}</span></div>)}</div></article><article className="panel service-health"><div className="panel-heading"><div><span className="eyebrow">模型网关</span><h3>服务健康度</h3></div><span className="healthy">● 全部正常</span></div>{[["文本生成","主服务商 A","98 ms","99.98%"],["语音识别","主服务商 B","312 ms","99.95%"],["向量检索","区域节点 SG","42 ms","100%"],["内容安全","双通道检测","76 ms","99.99%"]].map(x=><div className="service-row" key={x[0]}><span className="service-dot"/><p><strong>{x[0]}</strong><small>{x[1]}</small></p><span>{x[2]}</span><b>{x[3]}</b></div>)}<div className="region-note"><span>盾</span><p><strong>数据区域：新加坡</strong><small>未成年人数据未开启跨区复制</small></p></div></article></section>
    <article className="panel audit-strip"><div><span className="eyebrow">最近审计</span><h3>所有关键操作均可追溯</h3></div><div className="audit-events"><span><i/>教材版本 1.2 已发布 <small>10:24</small></span><span><i/>教师账号权限变更 <small>09:18</small></span><span><i/>模型切换演练通过 <small>昨天</small></span></div><button type="button">查看审计日志 →</button></article>
  </>;
}