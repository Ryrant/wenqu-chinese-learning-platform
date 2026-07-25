"use client";

import { useState } from "react";
import type { Notify } from "./dashboard";

export function ProgressRing({ value, label }: { value: number; label: string }) {
  return <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}><div><strong>{value}%</strong><span>{label}</span></div></div>;
}

export function StudentView({ notify }: { notify: Notify }) {
  const [lessonOpen, setLessonOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  function record() {
    if (recording) return;
    setRecording(true);
    setScore(null);
    window.setTimeout(() => { setRecording(false); setScore(92); }, 1800);
  }

  if (lessonOpen) {
    return <section className="lesson-stage">
      <button type="button" className="back-link" onClick={() => setLessonOpen(false)}>← 返回学习总览</button>
      <div className="lesson-header"><div><span className="eyebrow">故事闯关 · 第 2 关</span><h1>月饼里的团圆</h1><p>听一听，再把这句话读给文文老师听。</p></div><span className="step-pill">2 / 5</span></div>
      <div className="lesson-grid">
        <article className="story-card">
          <div className="moon-scene"><span className="moon">月</span><span className="cloud cloud-one"/><span className="cloud cloud-two"/><div className="family-table"><span>饼</span><span>茶</span><span>灯</span></div></div>
          <blockquote>“一家人坐在一起，分享香甜的月饼，这就是团圆。”</blockquote>
          <button type="button" className="sound-button" onClick={() => notify("正在播放示范音", "请注意“团圆”的声调和停顿。")}>▶ 听示范发音</button>
        </article>
        <article className="practice-card">
          <span className="eyebrow">轮到你了</span><h2>读出完整句子</h2>
          <p className="practice-sentence">一家人一起吃月饼。</p><p className="pinyin">Yì jiā rén yì qǐ chī yuè bǐng.</p>
          <button type="button" className={`record-button ${recording ? "recording" : ""}`} onClick={record} aria-label="开始录音"><span>{recording ? "•••" : "声"}</span></button>
          <p className="record-hint">{recording ? "正在倾听，请自然朗读…" : "点击开始朗读"}</p>
          {score !== null && <div className="speech-result"><div><strong>{score}</strong><span>发音得分</span></div><p><b>很棒！</b>“月饼”读得很清楚。再把“一起”连得自然一点，就更像中文母语者啦。</p></div>}
        </article>
      </div>
    </section>;
  }

  return <>
    <section className="welcome-row"><div><span className="eyebrow">星期六 · 连续学习第 12 天</span><h1>早上好，小语！</h1><p>今天也一起发现中文里的小惊喜吧。</p></div><div className="streak"><span>火</span><strong>12</strong><small>连续天数</small></div></section>
    <section className="hero-learning">
      <div className="hero-copy"><span className="tag">正在学习 · 中秋文化</span><h2>月饼里的<br/><em>团圆</em></h2><p>跟着故事认识“团圆”，完成看图说话和口语挑战。</p><div className="lesson-meta"><span>约 12 分钟</span><i/><span>已完成 2 / 5</span></div><button type="button" className="primary-button" onClick={() => setLessonOpen(true)}>继续闯关　→</button></div>
      <div className="hero-art" aria-label="中秋团圆主题插画"><span className="sun-disc">团</span><span className="roof roof-back"/><span className="roof roof-front"/><span className="lantern lantern-a">福</span><span className="lantern lantern-b">乐</span><span className="hill hill-a"/><span className="hill hill-b"/><span className="person person-a">小</span><span className="person person-b">语</span></div>
    </section>
    <section className="dashboard-grid">
      <article className="panel daily-progress"><div className="panel-heading"><div><span className="eyebrow">今日进度</span><h3>稳稳向前</h3></div><button type="button">本周⌄</button></div><div className="progress-content"><ProgressRing value={68} label="今日目标"/><div className="task-list"><div className="done"><span>✓</span><p><strong>汉字小练习</strong><small>认识“月、圆、家”</small></p><b>+20</b></div><div className="current"><span>声</span><p><strong>口语跟读</strong><small>练习“一家人”</small></p><b>进行中</b></div><div><span>册</span><p><strong>文化小问答</strong><small>中秋为什么吃月饼？</small></p><b>+15</b></div></div></div></article>
      <article className="panel pathway"><div className="panel-heading"><div><span className="eyebrow">我的学习路</span><h3>生活与家人</h3></div><span className="level-chip">初中级 · A2</span></div><div className="path-line">{[["✓","我的家","已掌握"],["月","节日团圆","学习中"],["食","家乡味道","待解锁"],["校","校园一天","待解锁"]].map((item,i)=><div className={`path-node ${i===0?"complete":i===1?"active":""}`} key={item[1]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></div>)}</div></article>
    </section>
  </>;
}