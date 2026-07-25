"use client";

import { useMemo, useState } from "react";
import { AdminView, GuardianView, TeacherView } from "./staff-views";
import { StudentView } from "./student-view";

export type Notify = (title: string, detail: string) => void;
type Role = "student" | "teacher" | "guardian" | "admin";
type Toast = { title: string; detail: string } | null;

const roles: Array<{ id: Role; label: string; name: string }> = [
  { id: "student", label: "学生", name: "林小语" },
  { id: "teacher", label: "教师", name: "陈老师" },
  { id: "guardian", label: "家长", name: "小语家长" },
  { id: "admin", label: "机构", name: "南洋华文学校" },
];

const navigation: Record<Role, string[]> = {
  student: ["学习总览", "AI 课堂", "学习任务", "成长档案"],
  teacher: ["教学总览", "AI 备课", "班级管理", "作业批阅"],
  guardian: ["孩子概览", "成长报告", "家庭任务", "授权管理"],
  admin: ["机构总览", "内容中心", "知识库", "权限审计"],
};

export function Dashboard() {
  const [role, setRole] = useState<Role>("student");
  const [activeNav, setActiveNav] = useState(navigation.student[0]);
  const [language, setLanguage] = useState<"中" | "EN">("中");
  const [toast, setToast] = useState<Toast>(null);
  const current = useMemo(() => roles.find((item) => item.id === role) ?? roles[0], [role]);

  const notify: Notify = (title, detail) => {
    setToast({ title, detail });
    window.setTimeout(() => setToast(null), 3200);
  };

  function switchRole(next: Role) {
    setRole(next);
    setActiveNav(navigation[next][0]);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">文</span><div><strong>文趣</strong><small>华文教学助手</small></div></div>
        <nav className="side-nav" aria-label="主导航">
          {navigation[role].map((item, index) => (
            <button type="button" key={item} className={activeNav === item ? "active" : ""} onClick={() => setActiveNav(item)}>
              <span className="nav-mark">{["⌂", "✦", "册", "◎"][index]}</span><span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="culture-note"><span>春</span><div><strong>今日文化卡</strong><p>春风又绿江南岸</p><button type="button" onClick={() => notify("文化卡已收藏", "稍后可在成长档案中复习。")}>收进我的锦囊 →</button></div></div>
        <div className="sidebar-footer"><button type="button">?　帮助与反馈</button><span>盾　未成年人保护已开启</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">文</span><strong>文趣</strong></div>
          <div className="role-switcher" aria-label="体验角色">
            {roles.map((item) => <button type="button" key={item.id} className={role === item.id ? "active" : ""} onClick={() => switchRole(item.id)}>{item.label}</button>)}
          </div>
          <div className="top-actions">
            <button type="button" className="language-toggle" onClick={() => setLanguage(language === "中" ? "EN" : "中")}>{language} / {language === "中" ? "EN" : "中"}</button>
            <button type="button" className="notification" aria-label="通知" onClick={() => notify("没有新通知", "今天的学习与审核事项都已同步。")}>◌<i /></button>
            <div className="profile"><span className={`avatar ${role}`}>{current.label[0]}</span><div><strong>{current.name}</strong><small>{current.label}工作台</small></div></div>
          </div>
        </header>
        <div className="content">
          {role === "student" && <StudentView notify={notify} />}
          {role === "teacher" && <TeacherView notify={notify} />}
          {role === "guardian" && <GuardianView notify={notify} />}
          {role === "admin" && <AdminView notify={notify} />}
        </div>
      </section>

      {toast && <div className="toast" role="status"><span>✓</span><div><strong>{toast.title}</strong><p>{toast.detail}</p></div></div>}
    </main>
  );
}