"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "../lib/supabase";

function getAuthErrorMessage(message: string, isLogin: boolean) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
    return "E-posta adresi veya şifre hatalı.";
  }
  if (normalized.includes("user already registered") || normalized.includes("already been registered")) {
    return "Bu e-posta adresiyle kayıtlı bir hesap zaten var. Giriş yapmayı deneyebilirsin.";
  }
  if (normalized.includes("password") && (normalized.includes("at least") || normalized.includes("characters"))) {
    return "Şifren en az 6 karakter olmalı.";
  }
  if (normalized.includes("email") && normalized.includes("invalid")) {
    return "Geçerli bir e-posta adresi gir.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Devam etmek için önce e-posta adresini doğrula.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.";
  }

  return isLogin
    ? "Giriş yapılamadı. E-posta ve şifreni kontrol edip tekrar dene."
    : "Hesap oluşturulamadı. Bilgilerini kontrol edip tekrar dene.";
}

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setMessageIsError(false);

    try {
      const result = isLogin
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });

      if (result.error) {
        console.error("Supabase Auth hatası:", result.error);
        setMessage(getAuthErrorMessage(result.error.message, isLogin));
        setMessageIsError(true);
      } else if (!isLogin) {
        setMessage("Hesabın oluşturuldu. Giriş yapmadan önce e-posta doğrulaması gerekebilir.");
      }
    } catch (error) {
      console.error("Supabase Auth isteği başarısız:", error);
      setMessage("Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.");
      setMessageIsError(true);
    } finally {
      setLoading(false);
    }
  }

  function selectMode(nextIsLogin: boolean) {
    if (loading) return;
    setIsLogin(nextIsLogin);
    setMessage("");
    setMessageIsError(false);
  }

  return (
    <main className="page authScreen">
      <section className="authCard" aria-labelledby="auth-title">
        <div className="authBrand">
          <div className="authLogo">
            <Image
              src="/fiyor-logo.jpg"
              alt=""
              width={52}
              height={52}
              priority
            />
          </div>
          <div>
            <p className="authEyebrow">Kişisel finansın, fiyort sakinliğinde</p>
            <h1 id="auth-title">Fiyor₺X</h1>
          </div>
        </div>

        <p className="authSubtitle">
          Gelirini, harcamalarını ve hedeflerini tek bir yerde güvenle yönet.
        </p>

        <div className="authMode" role="tablist" aria-label="Hesap işlemi">
          <button
            className={isLogin ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={isLogin}
            onClick={() => selectMode(true)}
            disabled={loading}
          >
            Giriş Yap
          </button>
          <button
            className={!isLogin ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={!isLogin}
            onClick={() => selectMode(false)}
            disabled={loading}
          >
            Kayıt Ol
          </button>
        </div>

        <form onSubmit={handleSubmit} className="authForm">
          <div className="authField">
            <label htmlFor="auth-email">E-posta adresi</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ornek@mail.com"
            />
          </div>

          <div className="authField">
            <label htmlFor="auth-password">Şifre</label>
            <div className="authPassword">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="En az 6 karakter"
              />
              <button
                className="authPasswordToggle"
                type="button"
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7" />
                    <path d="M9.9 5.2A10.7 10.7 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.3 2-2.8 3.4M6.2 6.3C4.1 7.7 2.8 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {message && (
            <p
              className={`authMessage${messageIsError ? " isError" : " isSuccess"}`}
              role={messageIsError ? "alert" : "status"}
              aria-live="polite"
            >
              {message}
            </p>
          )}

          <button className="authSubmit" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="authSpinner" aria-hidden="true" />
                <span>{isLogin ? "Giriş yapılıyor..." : "Hesap oluşturuluyor..."}</span>
              </>
            ) : (
              isLogin ? "Giriş Yap" : "Kayıt Ol"
            )}
          </button>
        </form>

        <p className="authFootnote">Finansal bilgilerinin kontrolü her zaman sende.</p>
      </section>
    </main>
  );
}
