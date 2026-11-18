"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setMessage("Giriş hatası: E-posta veya şifre yanlış.");
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) {
        setMessage("Kayıt hatası: " + error.message);
      } else {
        setMessage("Kayıt başarılı! Giriş yapılıyor...");
      }
    }

    setLoading(false);
  }

  return (
    <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="panel" style={{ width: "100%", maxWidth: "420px", padding: "32px" }}>
        <div className="logoLine" style={{ justifyContent: "center", marginBottom: "16px" }}>
          <div className="logo">
            <Image
              className="logoImage"
              src="/fiyor-logo.jpg"
              alt="fiyor₺X logosu"
              width={52}
              height={52}
              priority
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">fiyor₺X</h1>
        </div>

        <p style={{ textAlign: "center", color: "var(--muted)", marginBottom: "24px" }}>
          {isLogin ? "Kasana erişmek için giriş yap." : "Yeni bir kasa oluşturmak için kayıt ol."}
        </p>

        <form onSubmit={handleSubmit} className="sectionStack">
          <div className="field">
            <label>E-posta Adresi</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@mail.com"
            />
          </div>

          <div className="field">
            <label>Şifre (En az 6 karakter)</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
            />
          </div>

          {message && (
            <p
              style={{
                color: "#FFFFFF",
                fontSize: "14px",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              {message}
            </p>
          )}

          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Bekleniyor..." : isLogin ? "Giriş Yap" : "Kayıt Ol"}
          </button>

          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setMessage("");
            }}
            style={{ width: "100%" }}
          >
            {isLogin ? "Hesabın yok mu? Kayıt Ol" : "Zaten hesabın var mı? Giriş Yap"}
          </button>
        </form>
      </div>
    </main>
  );
}