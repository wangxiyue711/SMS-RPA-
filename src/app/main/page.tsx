"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 将原 main_app.html 改造成 Next.js 页面：
 * - Firebase 从环境变量读取
 * - 未登录跳转到 /login
 * - 保留你全部的 DOM 操作与窗口全局 API（window.FirebaseAPI 等）
 * - 样式改为内联 <style jsx>
 */
export default function MainAppPage() {
  const router = useRouter();

  useEffect(() => {
    // ========== Firebase 动态初始化 ==========
    (async () => {
      const { initializeApp } = await import("firebase/app");
      const { getAuth, onAuthStateChanged, signOut } = await import("firebase/auth");
      const { getFirestore, doc, getDoc, setDoc, updateDoc } = await import("firebase/firestore");

      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      };

      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);

      (window as any).auth = auth;
      (window as any).db = db;

      // ====== 把你原来的 FirebaseAPI 能力挂到 window 上 ======
      (window as any).FirebaseAPI = {
        async logoutUser() {
          try {
            await signOut(auth);
            return { success: true };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        },

        // 读取/创建用户配置
        async getUserConfig() {
          if (!(window as any).currentUser) {
            throw new Error("ログインが必要です");
          }
          try {
            const user = (window as any).currentUser;
            const ref = doc(db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            if (snap.exists()) {
              return snap.data();
            } else {
              const defaultConfig = {
                user_id: user.uid,
                email: user.email,
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
          } catch (e: any) {
            throw new Error("設定の取得に失敗しました: " + e.message);
          }
        },

        async updateEmailConfig(emailAddress: string, appPassword: string, sitePassword: string) {
          if (!(window as any).currentUser) throw new Error("ログインが必要です");
          try {
            const user = (window as any).currentUser;
            const ref = doc(db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            const payload = {
              email_config: {
                address: emailAddress,
                app_password: appPassword,
                site_password: sitePassword,
              },
              updated_at: new Date(),
            };
            if (snap.exists()) {
              await updateDoc(ref, payload);
            } else {
              await setDoc(ref, {
                user_id: user.uid,
                email: user.email,
                email_config: payload.email_config,
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
              });
            }
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },

        detectProvider(apiUrl: string) {
          const url = (apiUrl || "").toLowerCase();
          if (url.includes("sms-console.jp")) return "sms-console";
          if (url.includes("twilio.com")) return "twilio";
          if (url.includes("vonage.com") || url.includes("nexmo.com")) return "vonage";
          if (url.includes("messagebird.com")) return "messagebird";
          if (url.includes("plivo.com")) return "plivo";
          return "custom";
        },

        async updateSmsConfig(apiUrl: string, apiId: string, apiPassword: string, smsTextA: string, smsTextB: string) {
          if (!(window as any).currentUser) throw new Error("ログインが必要です");
          try {
            const user = (window as any).currentUser;
            const ref = doc(db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            const smsConfig = {
              api_url: apiUrl,
              api_id: apiId,
              api_password: apiPassword,
              sms_text_a: smsTextA,
              sms_text_b: smsTextB,
              use_delivery_report: false,
              provider: (window as any).FirebaseAPI.detectProvider(apiUrl),
            };
            if (snap.exists()) {
              await updateDoc(ref, { sms_config: smsConfig, updated_at: new Date() });
            } else {
              await setDoc(ref, {
                user_id: user.uid,
                email: user.email,
                email_config: { address: "", app_password: "", site_password: "" },
                sms_config: smsConfig,
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },

        async getRpaConfig() {
          try {
            const config = await (window as any).FirebaseAPI.getUserConfig();
            return {
              success: true,
              config: {
                email: config.email_config?.address,
                emailPassword: config.email_config?.app_password,
                sitePassword: config.email_config?.site_password,
                smsProvider: config.sms_config?.provider,
                smsApiUrl: config.sms_config?.api_url,
                smsApiId: config.sms_config?.api_id,
                smsApiPassword: config.sms_config?.api_password,
                smsTextA: config.sms_config?.sms_text_a,
                smsTextB: config.sms_config?.sms_text_b,
              },
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      };

      // ========== 认证状态 ==========
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          // 跳转到 /login
          router.replace("/login");
        } else {
          (window as any).currentUser = user;
          const el = document.getElementById("userEmail");
          if (el) el.textContent = user.email || "";
          try {
            await loadUserConfigToForms();
          } catch {}
        }
      });

      // ========== 你原来的“把配置加载到表单” ==========
      async function loadUserConfigToForms() {
        try {
          const config = await (window as any).FirebaseAPI.getUserConfig();
          // 邮箱
          (document.getElementById("emailAddress") as HTMLInputElement | null)!.value =
            config.email_config?.address || "";
          (document.getElementById("emailAppPassword") as HTMLInputElement | null)!.value =
            config.email_config?.app_password || "";
          (document.getElementById("sitePassword") as HTMLInputElement | null)!.value =
            config.email_config?.site_password || "";
          // SMS
          (document.getElementById("smsApiUrl") as HTMLInputElement | null)!.value =
            config.sms_config?.api_url || "";
          (document.getElementById("smsApiId") as HTMLInputElement | null)!.value =
            config.sms_config?.api_id || "";
          (document.getElementById("smsApiPassword") as HTMLInputElement | null)!.value =
            config.sms_config?.api_password || "";
          (document.getElementById("smsTextA") as HTMLTextAreaElement | null)!.value =
            config.sms_config?.sms_text_a || "";
          (document.getElementById("smsTextB") as HTMLTextAreaElement | null)!.value =
            config.sms_config?.sms_text_b || "";
        } catch (e) {
          console.error("設定ロード失敗:", e);
        }
      }

      // 把函数挂到 window，供 HTML onsubmit / onclick 使用（与你原来一致）
      (window as any).handleLogout = async function () {
        if (confirm("ログアウトしますか？")) {
          await (window as any).FirebaseAPI.logoutUser();
          router.replace("/login");
        }
      };

      (window as any).saveAccountConfig = async function (e: SubmitEvent) {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement)?.value || "";
        const statusEl = document.getElementById("accountStatus")!;
        if (!(window as any).currentUser) {
          statusEl.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
          return;
        }
        statusEl.innerHTML = '<span style="color:#1976d2;">💾 設定を保存中...</span>';
        const res = await (window as any).FirebaseAPI.updateEmailConfig(
          get("emailAddress"),
          get("appPassword"),
          get("sitePassword")
        );
        statusEl.innerHTML = res.success
          ? '<span style="color:#388e3c;">✅ アカウント設定が保存されました</span>'
          : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
      };

      (window as any).saveSmsConfig = async function (e: SubmitEvent) {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement)?.value || "";
        const statusEl = document.getElementById("smsStatus")!;
        if (!(window as any).currentUser) {
          statusEl.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
          return;
        }
        statusEl.innerHTML = '<span style="color:#1976d2;">💾 設定を保存中...</span>';
        const res = await (window as any).FirebaseAPI.updateSmsConfig(
          get("smsApiUrl"),
          get("smsApiId"),
          get("smsApiPassword"),
          (document.getElementById("smsTextA") as HTMLTextAreaElement)?.value || "",
          (document.getElementById("smsTextB") as HTMLTextAreaElement)?.value || ""
        );
        statusEl.innerHTML = res.success
          ? '<span style="color:#388e3c;">✅ SMS設定が保存されました（5項目完了）</span>'
          : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
      };

      // 左侧菜单切换
      document.addEventListener("DOMContentLoaded", function () {
        const navs = [
          { btn: "navMail", panel: "panelMail" },
          { btn: "navApi", panel: "panelApi" },
          { btn: "navRpa", panel: "panelRpa" },
          { btn: "navSms", panel: "panelSms" },
        ];
        function hideAll() {
          navs.forEach(({ btn, panel }) => {
            document.getElementById(btn)?.classList.remove("active");
            const p = document.getElementById(panel);
            if (p) {
              p.classList.remove("active");
              (p as HTMLElement).style.display = "none";
            }
          });
        }
        navs.forEach(({ btn, panel }) => {
          const b = document.getElementById(btn);
          if (!b) return;
          b.addEventListener("click", function () {
            hideAll();
            b.classList.add("active");
            const p = document.getElementById(panel);
            if (p) {
              p.classList.add("active");
              (p as HTMLElement).style.display = "block";
            }
            if (panel === "panelRpa") {
              (window as any).initializeRpaStatus();
              (window as any).loadRpaConfig();
            }
          });
        });
        // 默认显示第一个
        document.getElementById("navMail")?.classList.add("active");
        const p = document.getElementById("panelMail");
        if (p) {
          p.classList.add("active");
          (p as HTMLElement).style.display = "block";
        }
      });

      // ======== RPA 相关 ========
      const API_BASE_URL = "http://localhost:8888"; // TODO: 需要时改为你的服务地址

      // 状态显示帮助
      (window as any).updateConfigStatus = function (elementId: string, isConfigured: any, displayText: string) {
        const statusElement = document.getElementById(elementId)!;
        const statusIcon = statusElement.parentElement!.querySelector(".status-icon") as HTMLElement;
        statusElement.textContent = displayText;
        statusIcon.className = "status-icon";
        if (isConfigured === "loading") {
          statusIcon.classList.add("status-pending");
          statusIcon.textContent = "⏳";
        } else if (isConfigured) {
          statusIcon.classList.add("status-ok");
          statusIcon.textContent = "✅";
        } else {
          statusIcon.classList.add("status-error");
          statusIcon.textContent = "❌";
        }
      };

      (window as any).initializeRpaStatus = function () {
        ["emailStatus","smsApiStatus","apiIdStatus","apiPasswordStatus","templateAStatus","templateBStatus"]
          .forEach(id => (window as any).updateConfigStatus(id, "loading", "読み込み中..."));
      };

      (window as any).loadRpaConfig = async function () {
        try {
          const result = await (window as any).FirebaseAPI.getRpaConfig();
        // @ts-ignore
          if (result.success) {
            const c = result.config;
            (window as any).updateConfigStatus("emailStatus", c.email, c.email || "未設定");
            (window as any).updateConfigStatus("smsApiStatus", c.smsApiUrl, c.smsApiUrl ? `(${c.smsApiUrl})` : "未設定");
            (window as any).updateConfigStatus("apiIdStatus", c.smsApiId, c.smsApiId ? "設定済み" : "未設定");
            (window as any).updateConfigStatus("apiPasswordStatus", c.smsApiPassword, c.smsApiPassword ? "設定済み" : "未設定");
            (window as any).updateConfigStatus("templateAStatus", c.smsTextA, c.smsTextA ? "設定済み" : "未設定");
            (window as any).updateConfigStatus("templateBStatus", c.smsTextB, c.smsTextB ? "設定済み" : "未設定");
          } else {
            ["emailStatus","smsApiStatus","apiIdStatus","apiPasswordStatus","templateAStatus","templateBStatus"]
              .forEach(id => (window as any).updateConfigStatus(id, false, "エラー"));
          }
        } catch {
          ["emailStatus","smsApiStatus","apiIdStatus","apiPasswordStatus","templateAStatus","templateBStatus"]
            .forEach(id => (window as any).updateConfigStatus(id, false, "エラー"));
        }
      };

      (window as any).rpaStatus = { isRunning:false, processId:null, startTime:null as any, logs:[] as any[] };
      let statusPollingInterval: any = null;

      (window as any).showRpaModeDialog = function (): Promise<{mode:string; interval:number} | null> {
        return new Promise((resolve) => {
          const dialog = document.createElement("div");
          dialog.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;`;
          dialog.innerHTML = `
            <div style="background:#fff;padding:24px;border-radius:8px;max-width:420px;width:90%;">
              <h3 style="margin:0 0 16px;color:#6f8333;">RPA実行モード選択</h3>
              <label style="display:block;margin:8px 0;"><input type="radio" name="rpaMode" value="1" checked style="margin-right:8px;">単発実行</label>
              <label style="display:block;margin:8px 0;"><input type="radio" name="rpaMode" value="2" style="margin-right:8px;">連続監視</label>
              <div id="intervalSetting" style="margin: 12px 0; display:none;">
                監視間隔（秒）: <input type="number" id="intervalInput" value="5" min="1" max="3600" style="width: 70px;margin-left:8px;">
              </div>
              <div style="text-align:right;margin-top:12px;">
                <button id="cancelBtn" style="background:#6c757d;color:#fff;border:none;padding:8px 12px;border-radius:4px;margin-right:8px;">キャンセル</button>
                <button id="okBtn" style="background:#6f8333;color:#fff;border:none;padding:8px 12px;border-radius:4px;">実行開始</button>
              </div>
            </div>
          `;
          const radios = dialog.querySelectorAll('input[name="rpaMode"]');
          radios.forEach(r => r.addEventListener("change", () => {
            (dialog.querySelector("#intervalSetting") as HTMLElement).style.display =
              (r as HTMLInputElement).value === "2" ? "block" : "none";
          }));
          (dialog.querySelector("#cancelBtn") as HTMLButtonElement).onclick = () => { dialog.remove(); resolve(null); };
          (dialog.querySelector("#okBtn") as HTMLButtonElement).onclick = () => {
            const mode = (dialog.querySelector('input[name="rpaMode"]:checked') as HTMLInputElement).value;
            const interval = parseInt((dialog.querySelector("#intervalInput") as HTMLInputElement).value || "5", 10);
            dialog.remove();
            resolve({ mode, interval });
          };
          document.body.appendChild(dialog);
        });
      };

      (window as any).executeRpa = async function () {
        const resultDiv = document.getElementById("rpaResult")!;
        try {
          resultDiv.style.display = "block";
          resultDiv.innerHTML = "<p>🔄 RPA設定を確認中...</p>";
          resultDiv.className = "result-display";
          const cfgRes = await (window as any).FirebaseAPI.getRpaConfig();
          if (!cfgRes.success) throw new Error(cfgRes.error);
          const c = cfgRes.config;
          const ok =
            c.email && c.emailPassword && c.sitePassword &&
            c.smsApiUrl && c.smsApiId && c.smsApiPassword && c.smsTextA && c.smsTextB;
          if (!ok) {
            resultDiv.innerHTML = `
              <h3>⚠️ 設定不完全</h3>
              <p>RPA実行前に設定を完了してください。</p>`;
            resultDiv.className = "result-display error";
            return;
          }
          if (!(window as any).currentUser) throw new Error("ユーザーがログインしていません");

          const modeSel = await (window as any).showRpaModeDialog();
          if (!modeSel) {
            resultDiv.innerHTML = "<p>RPA実行がキャンセルされました。</p>";
            return;
          }
          resultDiv.innerHTML = "<p>🚀 RPA プロセスを開始しています...</p>";
          const resp = await fetch(`${API_BASE_URL}/api/rpa/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userUid: (window as any).currentUser.uid, mode: modeSel.mode, interval: modeSel.interval || 5 }),
          });
          const data = await resp.json();
          if (data.success) {
            (window as any).rpaStatus.isRunning = true;
            (window as any).rpaStatus.processId = (window as any).currentUser.uid;
            (window as any).rpaStatus.startTime = new Date();
            resultDiv.innerHTML = `
              <h3>🚀 RPA実行開始</h3>
              <p>✅ RPA プロセスが正常に開始されました。</p>
              <div style="margin: 16px 0;">
                <strong>実行モード:</strong> ${modeSel.mode === "1" ? "単発実行" : `連続監視 (${modeSel.interval}秒)` }
              </div>
              <div style="margin: 16px 0;">
                <button onclick="stopRpa()" style="background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">🛑 RPA停止</button>
                <button onclick="refreshRpaStatus()" style="background:#17a2b8;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-left:8px;">状態更新</button>
                <button onclick="showRpaLogs()" style="background:#6c757d;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-left:8px;">📋 ログ表示</button>
              </div>
              <div id="rpaStatusInfo" style="margin-top:16px;padding:12px;background:#e8f5e8;border-radius:4px;font-size:.9em;">
                <div>開始時間: ${new Date().toLocaleString()}</div>
                <div>プロセスID: ${((window as any).currentUser.uid as string).slice(0,8)}...</div>
              </div>
            `;
            resultDiv.className = "result-display success";
            (window as any).startStatusPolling();
          } else {
            throw new Error(data.error);
          }
        } catch (e: any) {
          resultDiv.innerHTML = `
            <h3>❌ RPA実行エラー</h3>
            <p>エラー: ${e.message}</p>
            <div style="margin-top: 12px; font-size: 0.9em; color: #666;">
              RPA サーバーが起動しているか確認してください。（例: node rpa_server.js）
            </div>`;
          resultDiv.className = "result-display error";
        }
      };

      (window as any).stopRpa = async function () {
        if (!(window as any).rpaStatus.isRunning || !(window as any).currentUser) return;
        const resp = await fetch(`${API_BASE_URL}/api/rpa/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userUid: (window as any).currentUser.uid }),
        });
        const data = await resp.json();
        if (data.success) {
          (window as any).rpaStatus.isRunning = false;
          const div = document.getElementById("rpaResult")!;
          const seconds = (window as any).rpaStatus.startTime
            ? Math.round((Date.now() - (window as any).rpaStatus.startTime.getTime()) / 1000)
            : 0;
          div.innerHTML = `<h3>🛑 RPA停止完了</h3><p>✅ 停止されました。実行時間: ${seconds}秒</p>`;
          div.className = "result-display";
          (window as any).stopStatusPolling();
        }
      };

      (window as any).refreshRpaStatus = async function () {
        if (!(window as any).currentUser) return;
        const resp = await fetch(`${API_BASE_URL}/api/rpa/status/${(window as any).currentUser.uid}`);
        const data = await resp.json();
        if (data.success) {
          const info = document.getElementById("rpaStatusInfo");
          if (info) {
            info.innerHTML = `
              <div>状態: ${(window as any).getStatusText(data.status)}</div>
              <div>開始時間: ${data.startTime ? new Date(data.startTime).toLocaleString() : "-"}</div>
              ${data.endTime ? `<div>終了時間: ${new Date(data.endTime).toLocaleString()}</div>` : ""}
              <div>ログ件数: ${data.logCount || 0}件</div>
              ${data.error ? `<div style="color:red;">エラー: ${data.error}</div>` : ""}
            `;
          }
          if (["completed","error"].includes(data.status)) {
            (window as any).rpaStatus.isRunning = false;
            (window as any).stopStatusPolling();
          }
        }
      };

      (window as any).showRpaLogs = async function () {
        if (!(window as any).currentUser) return;
        const resp = await fetch(`${API_BASE_URL}/api/rpa/logs/${(window as any).currentUser.uid}?limit=100`);
        const data = await resp.json();
        if (data.success) {
          const w = window.open("", "rpaLogs", "width=900,height=700,scrollbars=yes");
          if (!w) return;
          w.document.write(`
            <html><head><title>RPA ログ</title></head>
            <body style="font-family:monospace;padding:16px;background:#f5f5f5;">
              <h2>🔍 RPA 実行ログ</h2>
              <div style="margin:8px 0;">総ログ数: ${data.totalLogs}</div>
              <hr>
              ${data.logs.map((log:any)=>`
                <div style="margin:4px 0;padding:8px;background:${log.type==='stderr'?'#ffe6e6':'#fff'};border-left:3px solid ${log.type==='stderr'?'#dc3545':'#28a745'};">
                  <div style="font-size:.8em;color:#666;">${new Date(log.timestamp).toLocaleString()} [${log.type.toUpperCase()}]</div>
                  <pre style="margin:4px 0;white-space:pre-wrap;">${log.message}</pre>
                </div>`).join("")}
            </body></html>
          `);
        }
      };

      (window as any).getStatusText = function (s: string) {
        const m: any = { running: "🟢 実行中", completed: "✅ 完了", error: "❌ エラー", stopped: "🛑 停止", not_running:"⚫ 停止中" };
        return m[s] || s;
      };

      (window as any).startStatusPolling = function () {
        if (statusPollingInterval) return;
        statusPollingInterval = setInterval(() => {
          if ((window as any).rpaStatus.isRunning) (window as any).refreshRpaStatus();
          else (window as any).stopStatusPolling();
        }, 5000);
      };
      (window as any).stopStatusPolling = function () {
        if (statusPollingInterval) { clearInterval(statusPollingInterval); statusPollingInterval = null; }
      };

      // ======= SMS 个别发送 & 模板 =======
      (window as any).toggleTemplate = function () {
        const c = document.getElementById("useTemplate") as HTMLInputElement;
        const s = document.getElementById("templateSelector") as HTMLElement;
        s.style.display = c?.checked ? "block" : "none";
      };

      (window as any).loadTemplate = async function (type: "A"|"B") {
        try {
          const cfg = await (window as any).FirebaseAPI.getUserConfig();
          const ta = document.getElementById("smsContent") as HTMLTextAreaElement;
          if (type === "A" && cfg.sms_config?.sms_text_a) ta.value = cfg.sms_config.sms_text_a;
          else if (type === "B" && cfg.sms_config?.sms_text_b) ta.value = cfg.sms_config.sms_text_b;
          else alert(`テンプレート${type}が設定されていません。SMS設定で先に設定してください。`);
        } catch (e: any) {
          alert("テンプレートの読み込みに失敗しました: " + e.message);
        }
      };

      (window as any).sendIndividualSms = async function (e: SubmitEvent) {
        e.preventDefault();
        const phone = (document.getElementById("recipientPhone") as HTMLInputElement).value.trim();
        const message = (document.getElementById("smsContent") as HTMLTextAreaElement).value.trim();
        const resultDiv = document.getElementById("smsResult")!;
        if (!(window as any).currentUser) {
          resultDiv.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
          return;
        }
        try {
          resultDiv.innerHTML = '<span style="color:#1976d2;">📤 SMS送信中...</span>';
          const resp = await fetch(`${API_BASE_URL}/api/sms/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userUid: (window as any).currentUser.uid, phone, message }),
          });
          const data = await resp.json();
          if (data.success) {
            resultDiv.innerHTML = '<span style="color:#388e3c;">✅ SMS送信成功！</span>';
            const statusInfo = data.output ? (data.output.match(/STATUS:\s*(\d+)/)?.[1] || "200") : "200";
            (window as any).addToSmsHistory(phone, message, "success", `ステータス: ${statusInfo}`);
            (document.getElementById("recipientPhone") as HTMLInputElement).value = "";
            (document.getElementById("smsContent") as HTMLTextAreaElement).value = "";
            (document.getElementById("useTemplate") as HTMLInputElement).checked = false;
            (window as any).toggleTemplate();
          } else {
            const statusInfo = data.details ? (data.details.match(/STATUS:\s*(\d+)/)?.[1] || "Unknown") : "Unknown";
            resultDiv.innerHTML = `<span style="color:#d32f2f;">❌ SMS送信失敗: ${data.error}</span>`;
            (window as any).addToSmsHistory(phone, message, "failed", `ステータス: ${statusInfo} - ${data.error}`);
          }
        } catch (e: any) {
          resultDiv.innerHTML = `<span style="color:#d32f2f;">❌ エラー: ${e.message}</span>`;
          (window as any).addToSmsHistory(phone, message, "error", `接続エラー: ${e.message}`);
        }
      };

      // 发送历史
      (window as any).smsHistory = JSON.parse(localStorage.getItem("smsHistory") || "[]");
      (window as any).addToSmsHistory = function (phone: string, message: string, status: "success"|"failed"|"error", statusInfo?: string) {
        const item = {
          timestamp: new Date().toLocaleString("ja-JP"),
          phone,
          message: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
          status,
          statusInfo: statusInfo || null,
        };
        (window as any).smsHistory.unshift(item);
        if ((window as any).smsHistory.length > 100) (window as any).smsHistory = (window as any).smsHistory.slice(0, 100);
        localStorage.setItem("smsHistory", JSON.stringify((window as any).smsHistory));
        (window as any).updateSmsHistoryDisplay();
      };

      (window as any).updateSmsHistoryDisplay = function () {
        const historyDiv = document.getElementById("smsHistory");
        if (!historyDiv) return;
        const arr = (window as any).smsHistory as any[];
        if (!arr.length) {
          historyDiv.innerHTML = '<p style="color:#666;text-align:center;margin:20px 0;font-style:italic;">送信履歴はここに表示されます</p>';
          return;
        }
        historyDiv.innerHTML = arr.map((item) => {
          const map:any = {
            success: { icon:"✅", color:"#388e3c", bg:"#e8f5e8" },
            failed:  { icon:"❌", color:"#d32f2f", bg:"#ffeaea" },
            error:   { icon:"💥", color:"#ff9800", bg:"#fff3e0" },
          };
          const m = map[item.status] || {icon:"❓", color:"#666", bg:"#f5f5f5"};
          return `
            <div style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:12px;background:linear-gradient(135deg,#fff 0%,${m.bg} 100%);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <div style="flex:1;">
                  <div style="font-weight:bold;font-size:1.05em;color:#333;margin-bottom:4px;">📱 ${item.phone}</div>
                  <div style="color:#666;font-size:.95em;line-height:1.4;margin-bottom:6px;">${item.message}</div>
                </div>
                <div style="display:flex;align-items:center;background:#fff;padding:4px 8px;border-radius:12px;border:1px solid ${m.color};color:${m.color};font-weight:600;font-size:.85em;">
                  ${m.icon} ${String(item.status).toUpperCase()}
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #f0f0f0;font-size:.8em;color:#888;">
                <span>🕒 ${item.timestamp}</span>
                ${item.statusInfo ? `<span style="color:${item.status==='success' ? '#388e3c' : '#d32f2f'};font-weight:500;">${item.statusInfo}</span>` : "" }
              </div>
            </div>`;
        }).join("");
      };

      (window as any).clearSmsHistory = function () {
        if (confirm("送信履歴をすべて削除しますか？")) {
          (window as any).smsHistory = [];
          localStorage.removeItem("smsHistory");
          (window as any).updateSmsHistoryDisplay();
        }
      };

      (window as any).checkServerConnection = async function () {
        const statusDiv = document.getElementById("connectionStatus")!;
        const statusText = document.getElementById("statusText")!;
        try {
          const resp = await fetch(`${API_BASE_URL}/api/health`, { method: "GET" });
          if (resp.ok) {
            statusDiv.style.backgroundColor = "#e8f5e8";
            statusDiv.style.color = "#2e7d2e";
            statusText.textContent = "✅ RPA服务器连接正常 (localhost:8888)";
          } else throw new Error("Server response not OK");
        } catch {
          statusDiv.style.backgroundColor = "#ffe6e6";
          statusDiv.style.color = "#d32f2f";
          statusText.innerHTML = "❌ RPA服务器未连接 - <strong>请运行: 启动RPA网站.bat</strong>";
        }
      };

      document.addEventListener("DOMContentLoaded", function () {
        setTimeout(() => {
          (window as any).updateSmsHistoryDisplay();
          (window as any).checkServerConnection();
        }, 1000);
        setInterval(() => (window as any).checkServerConnection(), 30000);
      });

      (window as any).checkUserStatus = function () {
        console.log("=== ユーザー状態チェック ===");
        console.log("window.currentUser:", (window as any).currentUser);
        console.log("auth.currentUser:", (window as any).auth?.currentUser);
      };
      setTimeout(() => (window as any).checkUserStatus(), 2000);
    })();
  }, [router]);

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <span className="brand-title">🤖 XXX XXXX</span>
        </div>
        <div className="user-info">
          <span id="userEmail">読み込み中...</span>
          <button id="logoutBtn" onClick={() => (window as any).handleLogout()}>ログアウト</button>
        </div>
      </header>

      <div className="main-wrapper">
        {/* Sidebar */}
        <nav className="sidebar">
          <ul className="nav-menu">
            <li><a href="#" className="active" id="navMail">アカウント設定</a></li>
            <li><a href="#" id="navApi">SMS設定</a></li>
            <li><a href="#" id="navRpa">RPA実行</a></li>
            <li><a href="#" id="navSms">個別送信テスト用</a></li>
          </ul>
        </nav>

        {/* Content */}
        <section className="main-content">
          {/* 账号设置 */}
          <div className="content-panel active" id="panelMail">
            <div className="panel-header">
              <h2 className="panel-title">📧 アカウント設定</h2>
              <p className="panel-description">RPA自動化に必要なアカウント情報を設定してください（3項目のみ）</p>
            </div>
            <form className="ai-form" onSubmit={(e:any)=> (window as any).saveAccountConfig(e)}>
              <label htmlFor="emailAddress">📬 メールアドレス</label>
              <input type="email" id="emailAddress" name="emailAddress" placeholder="example@gmail.com" required autoComplete="off" />
              <div className="ai-hint">RPAが監視するGmailアドレス（Indeed求人メール受信用）</div>

              <label htmlFor="emailAppPassword">🔑 Gmailアプリパスワード</label>
              <input type="password" id="emailAppPassword" name="appPassword" placeholder="16文字のアプリパスワード" required />
              <div className="ai-hint">Google設定→セキュリティ→2段階認証→アプリパスワードで生成</div>

              <label htmlFor="sitePassword">🌐 Indeedログインパスワード</label>
              <input type="password" id="sitePassword" name="sitePassword" placeholder="Indeedアカウントのパスワード" required />
              <div className="ai-hint">Indeed求人サイトにログインするためのパスワード</div>

              <button type="submit">💾 アカウント設定を保存</button>
            </form>
            <div id="accountStatus" className="ai-hint" style={{marginTop:16, minHeight:20}} />
          </div>

          {/* SMS 设置 */}
          <div className="content-panel" id="panelApi" style={{display:"none"}}>
            <div className="panel-header">
              <h2 className="panel-title">📱 SMS設定</h2>
              <p className="panel-description">
                SMS送信API設定とメッセージテンプレートを設定してください（5項目必須）<br />
                <small>対応API: SMS Console、Twilio、その他HTTP API提供商</small>
              </p>
            </div>
            <form className="ai-form" onSubmit={(e:any)=> (window as any).saveSmsConfig(e)}>
              <label htmlFor="smsApiUrl">🌐 SMS API URL</label>
              <input type="url" id="smsApiUrl" name="smsApiUrl" placeholder="https://www.sms-console.jp/api/ ..." required autoComplete="off" />
              <div className="ai-hint">各社のSMS API提供商のエンドポイントURL</div>

              <label htmlFor="smsApiId">🔑 SMS API ID / ユーザー名</label>
              <input type="text" id="smsApiId" name="smsApiId" placeholder="sm000206_user / ACxxxxxxxx (Twilio)" required autoComplete="off" />
              <div className="ai-hint">アカウントID / Account SID</div>

              <label htmlFor="smsApiPassword">🔐 SMS API パスワード / トークン</label>
              <input type="password" id="smsApiPassword" name="smsApiPassword" placeholder="API パスワード / Auth Token" required />
              <div className="ai-hint">認証用のパスワード/トークン</div>

              <label htmlFor="smsTextA">📄 SMSテンプレートA</label>
              <textarea id="smsTextA" name="smsTextA" rows={4} required />

              <label htmlFor="smsTextB">📝 SMSテンプレートB</label>
              <textarea id="smsTextB" name="smsTextB" rows={4} required />

              <button type="submit">💾 SMS設定を保存</button>
            </form>
            <div id="smsStatus" className="ai-hint" style={{marginTop:16, minHeight:20}} />
          </div>

          {/* SMS 发送 */}
          <div className="content-panel" id="panelSms" style={{display:"none"}}>
            <div className="panel-header">
              <h2 className="panel-title">📱 SMS送信</h2>
              <p className="panel-description">個別にSMSを送信できます。</p>
            </div>

            <div id="connectionStatus" style={{marginBottom:16,padding:8,borderRadius:4,fontSize:12}}>
              <span id="statusText">🔍 サーバー接続状態をチェック中...</span>
            </div>

            <form className="ai-form" onSubmit={(e:any)=> (window as any).sendIndividualSms(e)}>
              <label htmlFor="recipientPhone">📞 送信先電話番号</label>
              <input type="tel" id="recipientPhone" name="recipientPhone" placeholder="+8190..." required pattern="^(\+81|0)?[0-9]{10,11}$" />

              <label htmlFor="smsContent">💬 送信メッセージ</label>
              <textarea id="smsContent" name="smsContent" rows={6} maxLength={670} required />

              <div style={{margin:"16px 0"}}>
                <label>
                  <input type="checkbox" id="useTemplate" onChange={()=> (window as any).toggleTemplate()} />
                  既存のテンプレートを使用
                </label>
              </div>

              <div id="templateSelector" style={{display:"none",marginBottom:16}}>
                <button type="button" onClick={()=> (window as any).loadTemplate("A")} className="btnA">📄 テンプレートA</button>
                <button type="button" onClick={()=> (window as any).loadTemplate("B")} className="btnB">📝 テンプレートB</button>
              </div>

              <button type="submit" className="btnSend">📤 SMS送信</button>
            </form>

            <div id="smsResult" className="ai-hint" style={{marginTop:16,minHeight:20}} />
            <div style={{marginTop:32}}>
              <h3 style={{color:"#6f8333",marginBottom:16}}>📋 送信履歴</h3>
              <div id="smsHistory" className="historyBox">
                <p className="historyEmpty">送信履歴はここに表示されます</p>
              </div>
              <button type="button" onClick={()=> (window as any).clearSmsHistory()} className="btnClear">履歴をクリア</button>
            </div>
          </div>

          {/* RPA 执行 */}
          <div className="content-panel" id="panelRpa" style={{display:"none"}}>
            <div className="panel-header"><h2 className="panel-title">RPA実行</h2></div>

            <div className="config-status">
              <h3 style={{marginBottom:16,color:"#8c9569",fontSize:"1.1rem"}}>現在の設定状況</h3>
              <div id="configDisplay" className="config-display">
                {[
                  { id:"emailStatus", label:"📧 メール"},
                  { id:"smsApiStatus", label:"📱 SMS API"},
                  { id:"apiIdStatus", label:"🔑 API ID"},
                  { id:"apiPasswordStatus", label:"🔐 API パスワード"},
                  { id:"templateAStatus", label:"📄 テンプレートA"},
                  { id:"templateBStatus", label:"📝 テンプレートB"},
                ].map((x)=>(
                  <div className="config-item" key={x.id}>
                    <span className="icon">{x.label.split(" ")[0]}</span>
                    <span>{x.label.split(" ")[1]}: <span id={x.id}>読み込み中...</span></span>
                    <span className="status-icon"></span>
                  </div>
                ))}
              </div>
            </div>

            <button className="btn btn-primary" onClick={()=> (window as any).executeRpa()} style={{marginTop:20,padding:"12px 30px",fontSize:"1.1rem"}}>🚀 RPA実行</button>
            <div id="rpaResult" className="result-display" style={{marginTop:20, display:"none"}} />
            <div className="ai-hint" style={{marginTop:24}}>RPA実行前に、アカウント設定とSMS API設定が完了していることを確認してください。</div>
          </div>
        </section>
      </div>

      {/* 内联样式（把原 CSS 合并简化） */}
      <style jsx>{`
        *{box-sizing:border-box}
        body{background:#f8faef}
        .container{min-height:100vh;display:flex;flex-direction:column}
        .header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#fff;border-bottom:1px solid #eee}
        .brand-title{font-weight:700;color:#6f8333}
        .user-info button{margin-left:12px;padding:6px 10px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer}
        .main-wrapper{display:flex;min-height:calc(100vh - 56px)}
        .sidebar{width:220px;background:#f6f7f2;border-right:1px solid #e6e8d9;padding:16px}
        .nav-menu{list-style:none;padding:0;margin:0}
        .nav-menu li{margin-bottom:8px}
        .nav-menu a{display:block;padding:10px 12px;border-radius:8px;color:#43503a;text-decoration:none}
        .nav-menu a.active, .nav-menu a:hover{background:#e9eedb}
        .main-content{flex:1;padding:24px}
        .panel-header{margin-bottom:16px}
        .panel-title{color:#6f8333;margin:0}
        .panel-description{color:#666;margin:6px 0 0}
        .ai-form{display:flex;flex-direction:column;gap:10px;background:#fff;padding:16px;border:1px solid #e6e8d9;border-radius:12px}
        .ai-form input, .ai-form textarea{border:2px solid #e8eae0;border-radius:8px;padding:10px;background:#fafbf7;color:#43503a}
        .ai-form button{padding:10px 12px;background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}
        .ai-hint{font-size:12px;color:#666;margin-top:4px}
        .content-panel{display:none}
        .content-panel.active{display:block}
        .config-display{background:#fff;border:1px solid #e6e8d9;border-radius:12px;padding:12px}
        .config-item{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #eee}
        .config-item:last-child{border-bottom:none}
        .status-icon{min-width:24px;text-align:right}
        .historyBox{max-height:400px;overflow-y:auto;border:1px solid #e8eae0;border-radius:12px;padding:16px;background:#fafafa;box-shadow:inset 0 1px 3px rgba(0,0,0,.1)}
        .historyEmpty{color:#666;text-align:center;margin:20px 0;font-style:italic}
        .btnA{margin-right:8px;padding:6px 12px;background:#6f8333;color:#fff;border:none;border-radius:4px;cursor:pointer}
        .btnB{padding:6px 12px;background:#8fa446;color:#fff;border:none;border-radius:4px;cursor:pointer}
        .btnSend{background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%);color:#fff;font-weight:bold}
        .btnClear{margin-top:8px;margin-right:8px;padding:4px 8px;background:#dc3545;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
        .result-display{background:#fff;border:1px solid #e6e8d9;border-radius:12px;padding:12px}
        .result-display.success{border-color:#a5d6a7;background:#e8f5e9}
        .result-display.error{border-color:#ef9a9a;background:#ffebee}
        @media (max-width:960px){
          .main-wrapper{flex-direction:column}
          .sidebar{width:auto;display:flex;overflow-x:auto}
          .nav-menu{display:flex;gap:8px}
        }
      `}</style>
    </div>
  );
}
