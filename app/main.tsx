import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Dashboard } from "../components/workspace/dashboard";
import "./globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("应用入口不存在");
createRoot(root).render(<StrictMode><BrowserRouter><Dashboard/></BrowserRouter></StrictMode>);
