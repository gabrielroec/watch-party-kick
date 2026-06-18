import { useEffect, useState } from "react";

const RELEASES_API =
  "https://api.github.com/repos/gabrielroec/watch-party-kick/releases/latest";
const RELEASES_PAGE =
  "https://github.com/gabrielroec/watch-party-kick/releases/latest";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30min

interface LatestRelease {
  tag_name: string;
  html_url: string;
}

function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/, "").split(/[.\-]/).map((p) => parseInt(p, 10) || 0);
  const pa = clean(a);
  const pb = clean(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function UpdateBadge() {
  const [current, setCurrent] = useState<string>("");
  const [latest, setLatest] = useState<LatestRelease | null>(null);

  useEffect(() => {
    void window.wpk?.getVersion().then(setCurrent);
  }, []);

  useEffect(() => {
    if (!current) return;

    const check = async (): Promise<void> => {
      try {
        const r = await fetch(RELEASES_API, {
          headers: { accept: "application/vnd.github+json" },
        });
        if (!r.ok) return;
        const json = (await r.json()) as LatestRelease;
        if (!json?.tag_name) return;
        if (compareVersions(json.tag_name, current) > 0) {
          setLatest(json);
        } else {
          setLatest(null);
        }
      } catch {
        /* offline ou rate-limit: ignora silenciosamente */
      }
    };

    void check();
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [current]);

  if (!current) return null;

  const openRelease = (): void => {
    void window.wpk?.openExternal(latest?.html_url ?? RELEASES_PAGE);
  };

  return (
    <div className="update-badge">
      {latest ? (
        <button className="update-pill new" onClick={openRelease}>
          <span className="update-dot" />
          atualização {latest.tag_name} disponível · baixar
        </button>
      ) : (
        <span className="update-pill">beta {current}</span>
      )}
    </div>
  );
}
