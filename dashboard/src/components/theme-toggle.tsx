"use client";
import { useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "light" | "dark" | "system";
function preference(): Theme { try { const value=localStorage.getItem("ps-theme");return value==="light"||value==="dark"?value:"system"; } catch { const value=document.documentElement.dataset.themePreference;return value==="light"||value==="dark"?value:"system"; } }
function apply() { const value=preference();document.documentElement.setAttribute("data-theme",value==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):value); }
function subscribe(callback:()=>void) {
  const media=matchMedia("(prefers-color-scheme: dark)");
  const update=()=>{apply();callback();};
  window.addEventListener("storage",update);window.addEventListener("ps-theme-change",callback);media.addEventListener("change",update);
  return()=>{window.removeEventListener("storage",update);window.removeEventListener("ps-theme-change",callback);media.removeEventListener("change",update);};
}
export function ThemeToggle() {
  const selected=useSyncExternalStore(subscribe,preference,()=>"system" as Theme);
  function choose(value:Theme){document.documentElement.setAttribute("data-theme-preference",value);try{localStorage.setItem("ps-theme",value);}catch{/* Private browser storage may be unavailable. */}document.documentElement.setAttribute("data-theme",value==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):value);window.dispatchEvent(new Event("ps-theme-change"));}
  return <div className="theme-options" role="group" aria-label="Dashboard appearance">{[{value:"light",Icon:Sun,label:"Light theme"},{value:"dark",Icon:Moon,label:"Dark theme"},{value:"system",Icon:Monitor,label:"Use system theme"}].map(({value,Icon,label})=><button key={value} type="button" title={label} aria-label={label} aria-pressed={selected===value} onClick={()=>choose(value as Theme)}><Icon size={14}/></button>)}</div>;
}
