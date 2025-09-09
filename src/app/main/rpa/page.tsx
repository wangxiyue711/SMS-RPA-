// src/app/main/rpa/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

/**
 * /main/rpa —— RPA実行（独立页）
 * - Header / Sidebar / 登录态守卫：由 /main/layout.tsx 提供
 * - 本页负责：读取配置 → 按你的新规则校验 → 服务器健康检查 → 启动 RPA → 轮询状态/查看日志
 *
 * 校验规则（你要求的版本）：
 *   1) 邮箱格式：合法
 *   2) 应用专用密码：去掉空格后必须恰好 16 位（且为字母数字）
 *   3) RPA 读取目标邮箱：非空白
 *   4) Indeed 登录密码：非空白
 *   5) SMS API：URL/ID/Password 均非空白（不强制 URL 形状）
 *   6) 服务器连通：/api/health 必须 OK
 */

type CheckKey =
  | "emailFormat"
  | "targetMailbox"
  | "appPwd"
  | "sitePwd"
  | "apiUrl"
  | "apiId"
  | "apiPwd"
  | "server";

type CheckItem = {
  key: CheckKey;
  label: string;
  pass: boolean | null; // null=待检测/未知
  hint?: string;
};

export default function RpaPage() {
  const [userUid, setUserUid] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("読み込み中...");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const pollRef = useRef<any>(null);

  const [checks, setChecks] = useState<CheckItem[]>([
    { key: "emailFormat", label: "📧 メール形式", pass: null },
    { key: "targetMailbox", label: "📬 RPA対象メールボックス", pass: null },
    { key: "appPwd", label: "🔑 Gmailアプリパスワード(16桁)", pass: null },
    { key: "sitePwd", label: "🌐 Indeedログインパスワード", pass: null },
    { key: "apiUrl", label: "🌐 SMS API URL", pass: null },
    { key: "apiId", label: "🆔 SMS API ID", pass: null },
    { key: "apiPwd", label: "🔐 SMS API パスワード", pass: null },
    { key: "server", label: "🖥️ サーバー連携( /api/health )", pass: null },
  ]);

  const allPass = useMemo(() => checks.every((c) => c.pass === true), [checks]);

  // 读取 Firestore 的兜底方法（若未挂载 window.FirebaseAPI 时使用）
  async function getUserConfigFallback() {
    if (getApps().length === 0) {
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId:
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      });
    }
    const db = getFirestore();
    const user = (window as any).currentUser;
    if (!user?.uid) throw new Error("ログインが必要です");
    const ref = doc(db, "user_configs", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const defaultConfig = {
      user_id: user.uid,
      email: user.email ?? "",
      email_config: { address: "", app_password: "", site_password: "" },
      sms_config: {
        provider: "",
        api_url: "",
        api_id: "",
        api_password: "",
        sms_text_a: "",
        sms_text_b: "",
      },
      created_at: new Date(),
      updated_at: new Date(),
    };
    await setDoc(ref, defaultConfig);
    return defaultConfig;
  }

  // ------- 初始化：确保有 auth & 用户，并读取配置做校验 -------
  useEffect(() => {
    if (getApps().length === 0) {
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId:
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      });
    }
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        (window as any).currentUser = user;
        setUserUid(user.uid);
        await runChecks(); // 登录后马上检查一轮
      } else {
        setUserUid(null);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- 规则校验（按你最新要求） -------
  async function runChecks() {
    setStatusText("設定を確認中…");
    setLoading(true);

    try {
      // 1) 读取配置（优先用你挂到 window 的 API，缺失则兜底直连 Firestore）
      const api = (window as any).FirebaseAPI;
      const cfg = api?.getUserConfig
        ? await api.getUserConfig()
        : await getUserConfigFallback();

      // 2) 取值（并做最小规范化）
      const emailRaw = String(cfg?.email_config?.address ?? "");
      const appPwdRaw = String(cfg?.email_config?.app_password ?? "");
      const sitePwd = String(cfg?.email_config?.site_password ?? "");
      const apiUrl = String(cfg?.sms_config?.api_url ?? "");
      const apiId = String(cfg?.sms_config?.api_id ?? "");
      const apiPwd = String(cfg?.sms_config?.api_password ?? "");

      const email = emailRaw.trim();
      const appPwd = appPwdRaw.replace(/\s+/g, ""); // 去掉所有空格

      // 3) 校验：邮箱格式；App 密码 16 位；目标邮箱非空白；Indeed 密码非空白；API 三项非空白
      const emailFormatOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const appPwdOk =
        !!appPwd && appPwd.length === 16 && /^[A-Za-z0-9]{16}$/.test(appPwd);
      const targetMailboxNonEmpty = email.length > 0;
      const sitePwdOk = sitePwd.trim().length > 0;
      const apiUrlOk = apiUrl.trim().length > 0;
      const apiIdOk = apiId.trim().length > 0;
      const apiPwdOk = apiPwd.trim().length > 0;

      // 4) 服务器健康检查
      let serverPass = false,
        hint = "";
      try {
        const resp = await fetch("/api/health", { method: "GET" });
        serverPass = resp.ok;
        if (!serverPass) hint = "サーバーから OK 応答がありません";
      } catch {
        serverPass = false;
        hint = "サーバーに接続できません";
      }

      const updated: CheckItem[] = [
        {
          key: "emailFormat",
          label: "📧 メール形式",
          pass: emailFormatOk,
          hint: emailFormatOk ? "" : "メール形式を確認してください",
        },
        {
          key: "targetMailbox",
          label: "📬 RPA対象メールボックス",
          pass: targetMailboxNonEmpty,
          hint: targetMailboxNonEmpty ? "" : "必須です（空白不可）",
        },
        {
          key: "appPwd",
          label: "🔑 Gmailアプリパスワード(16桁)",
          pass: appPwdOk,
          hint: appPwdOk ? "" : "空白を除去し16桁の英数字で入力",
        },
        {
          key: "sitePwd",
          label: "🌐 Indeedログインパスワード",
          pass: sitePwdOk,
          hint: sitePwdOk ? "" : "必須です（空白不可）",
        },
        {
          key: "apiUrl",
          label: "🌐 SMS API URL",
          pass: apiUrlOk,
          hint: apiUrlOk ? "" : "必須です（空白不可）",
        },
        {
          key: "apiId",
          label: "🆔 SMS API ID",
          pass: apiIdOk,
          hint: apiIdOk ? "" : "必須です（空白不可）",
        },
        {
          key: "apiPwd",
          label: "🔐 SMS API パスワード",
          pass: apiPwdOk,
          hint: apiPwdOk ? "" : "必須です（空白不可）",
        },
        {
          key: "server",
          label: "🖥️ サーバー連携( /api/health )",
          pass: serverPass,
          hint,
        },
      ];
      setChecks(updated);
      setStatusText(
        updated.every((x) => x.pass)
          ? "✅ すべての前提条件を満たしました"
          : "⚠️ 未完了の設定があります"
      );
    } catch (e: any) {
      setStatusText(`❌ 設定の確認に失敗しました: ${e.message || e}`);
      setChecks((prev) => prev.map((c) => ({ ...c, pass: false })));
    } finally {
      setLoading(false);
    }
  }

  // ------- 启动 RPA -------
  async function handleStart() {
    if (!userUid) return;
    setLoading(true);
    setStatusText("RPAを起動しています…");
    try {
      const resp = await fetch("/api/rpa/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userUid }),
      });
      const data = await resp.json();
      if (!data?.success) {
        setStatusText(`❌ 起動に失敗: ${data?.error || "unknown error"}`);
        setLoading(false);
        return;
      }
      setStatusText("🟢 実行中…");
      setRunning(true);
      setStartedAt(Date.now());
      startPolling();
    } catch (e: any) {
      setStatusText(`❌ 起動エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ------- 轮询 RPA 状态 -------
  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (!userUid) return;
      try {
        const resp = await fetch(`/api/rpa/status/${userUid}`);
        const data = await resp.json();
        if (data?.success) {
          const state = String(data.status || "unknown");
          setStatusText(renderStatus(state, data));
          if (["completed", "error", "stopped"].includes(state)) {
            stopPolling();
            setRunning(false);
          }
        }
      } catch {
        // 忽略单次错误
      }
    }, 5000);
  }
  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
  useEffect(() => () => stopPolling(), []);

  // ------- 打开日志 -------
  function openLogs() {
    if (!userUid) return;
    window.open(
      `/api/rpa/logs/${userUid}?limit=200`,
      "rpaLogs",
      "width=900,height=700,scrollbars=yes"
    );
  }

  // ------- 個人情報ボタンハンドラ -------
  async function handlePersonalInfo() {
    setStatusText("個人情報を取得中...");
    try {
      const FirebaseAPI = (window as any).FirebaseAPI;
      const cfg = FirebaseAPI?.getUserConfig
        ? await FirebaseAPI.getUserConfig()
        : await getUserConfigFallback();

      const resp = await fetch("/api/rpa/personal-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userUid: (window as any).currentUser?.uid || cfg.user_id,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        const results = Array.isArray(data.data?.results)
          ? data.data.results
          : Array.isArray(data.results)
          ? data.results
          : [];
        // 1) save to server-side history
        try {
          await fetch("/api/rpa/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userUid: (window as any).currentUser?.uid || cfg.user_id,
              results,
            }),
          });
        } catch {}

        // localStorage 写入已移除：历史存储以云端 Firestore 为准

        setStatusText("✅ 個人情報取得完了");
        // navigate to history page to show table
        window.location.href = "/main/history";
      } else {
        setStatusText("❌ 個人情報取得失敗");
      }
    } catch (e: any) {
      window.alert("取得失敗: " + (e?.message || e));
      setStatusText("❌ 個人情報取得失敗");
    }
  }

  // SSE 日志面板已移除：简化 UI，仅保留核心按钮

  // ------- UI -------
  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: "#6f8333", margin: 0 }}>
          🛠️ RPA実行
        </h2>
        <p
          className="panel-description"
          style={{ color: "#666", margin: "6px 0 0" }}
        >
          実行前チェックをすべて通過すると、RPA を起動できます。
        </p>
      </div>

      <section
        style={{
          background: "#fff",
          border: "1px solid #e6e8d9",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, color: "#8c9569", fontSize: "1.05rem" }}>
            ✅ 前提チェック
          </h3>
          <div>
            <a
              href="/main/account"
              style={{
                marginRight: 8,
                fontSize: 13,
                color: "#6f8333",
                textDecoration: "underline",
              }}
            >
              アカウント設定へ
            </a>
            <a
              href="/main/sms"
              style={{
                fontSize: 13,
                color: "#6f8333",
                textDecoration: "underline",
              }}
            >
              SMS設定へ
            </a>
          </div>
        </div>

        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {checks.map((c) => {
            const map: any = {
              true: {
                icon: "✅",
                color: "#388e3c",
                bg: "#e8f5e8",
                border: "#a5d6a7",
              },
              false: {
                icon: "❌",
                color: "#d32f2f",
                bg: "#ffeaea",
                border: "#ef9a9a",
              },
              null: {
                icon: "⏳",
                color: "#888",
                bg: "#f5f5f5",
                border: "#ddd",
              },
            };
            const m = map[String(c.pass) as "true" | "false" | "null"];
            return (
              <li
                key={c.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${m.border}`,
                  background: m.bg,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: m.color, fontWeight: 700 }}>
                    {m.icon}
                  </span>
                  <span style={{ color: "#333" }}>{c.label}</span>
                </div>
                <div
                  style={{ fontSize: 12, color: c.pass ? "#777" : "#d32f2f" }}
                >
                  {c.hint || (c.pass ? "OK" : "")}
                </div>
              </li>
            );
          })}
        </ul>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={!allPass || loading || running || !userUid}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "none",
              fontWeight: 700,
              cursor:
                !allPass || loading || running ? "not-allowed" : "pointer",
              background: "linear-gradient(135deg,#6f8333 0%,#8fa446 100%)",
              color: "#fff",
            }}
            title={!allPass ? "未完了の設定があります" : undefined}
          >
            🚀 RPA実行
          </button>

          <button
            type="button"
            onClick={handlePersonalInfo}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e6e8d9",
              background: "#fff",
            }}
          >
            🧾 個人情報
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {statusText}
          {startedAt ? (
            <span style={{ marginLeft: 8, color: "#999" }}>
              （開始: {new Date(startedAt).toLocaleString("ja-JP")}）
            </span>
          ) : null}
        </div>
      </section>
    </>
  );
}

// 状态文案拼装
function renderStatus(state: string, data: any) {
  const map: Record<string, string> = {
    running: "🟢 実行中",
    completed: "✅ 完了",
    error: `❌ エラー${data?.error ? `: ${data.error}` : ""}`,
    stopped: "🛑 停止",
    not_running: "⚫ 停止中",
    unknown: "❓ 不明",
  };
  const base = map[state] || `ℹ️ 状態: ${state}`;
  const parts: string[] = [base];
  if (data?.startTime)
    parts.push(`開始: ${new Date(data.startTime).toLocaleString("ja-JP")}`);
  if (data?.endTime)
    parts.push(`終了: ${new Date(data.endTime).toLocaleString("ja-JP")}`);
  if (Number.isFinite(data?.logCount))
    parts.push(`ログ件数: ${data.logCount}件`);
  return parts.join(" / ");
}
