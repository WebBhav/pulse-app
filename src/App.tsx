import React, { useState, useEffect, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Plus,
  X,
  Share2,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Zap,
  Wifi,
  WifiOff,
  UserPlus,
  Smartphone,
  Sparkles,
  ExternalLink,
  Compass,
} from "lucide-react";
import { db, handleFirestoreError, OperationType } from "./lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  query,
  where,
  or,
  onSnapshot,
  collection,
} from "firebase/firestore";


interface User {
  id: string;
  name: string;
  color: string;
}

interface Connection {
  id: string;
  user1Id: string;
  user2Id: string;
  user1Name: string;
  user2Name: string;
  user1Color: string;
  user2Color: string;
  pokesCount: number;
  lastPokeTime: number;
  lastPokeFrom: string;
  partnerOnline?: boolean;
}

const GLOW_COLORS = [
  { name: "Neon Pink", hex: "#ff00f5", textClass: "text-[#ff00f5]", bgClass: "bg-[#ff00f5]", glowClass: "glow-pink" },
  { name: "Neon Blue", hex: "#00f3ff", textClass: "text-[#00f3ff]", bgClass: "bg-[#00f3ff]", glowClass: "glow-cyan" },
  { name: "Neon Lime", hex: "#bfff00", textClass: "text-[#bfff00]", bgClass: "bg-[#bfff00]", glowClass: "glow-lime" },
  { name: "Neon Orange", hex: "#f97316", textClass: "text-[#f97316]", bgClass: "bg-[#f97316]", glowClass: "glow-orange" },
];

export default function App() {
  // 1. Core States
  const [user, setUser] = useState<User | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);

  // Real-time presence dictionary of partners
  const [partnersPresence, setPartnersPresence] = useState<
    Record<string, { isOnline: boolean; lastActive: number }>
  >({});

  const enrichedConnections = useMemo(() => {
    return connections.map((conn) => {
      const partnerId = conn.user1Id === user?.id ? conn.user2Id : conn.user1Id;
      const presence = partnersPresence[partnerId];
      return {
        ...conn,
        partnerOnline: presence ? presence.isOnline : false,
      };
    });
  }, [connections, partnersPresence, user]);

  const [onboarding, setOnboarding] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // Audio & Haptic feedback settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrateSupported, setVibrateSupported] = useState(false);

  // Network & Database connection status
  const [syncConnected, setSyncConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invitation URL query params (if opened via an invite link)
  const [inviteInfo, setInviteInfo] = useState<User | null>(null);

  // Received active Poke notification modal
  const [activePoke, setActivePoke] = useState<{
    id: string;
    fromUserId: string;
    fromUserName: string;
    fromUserColor: string;
    timestamp: number;
  } | null>(null);

  // Overlay states
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteAccepted, setInviteAccepted] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [manualInviteId, setManualInviteId] = useState("");

  // Temporary local profile creation state
  const [tempName, setTempName] = useState("");
  const [selectedColor, setSelectedColor] = useState(GLOW_COLORS[0].hex);

  // Keep track of ongoing animations/ripples on pokes
  const [ripplingConnectionId, setRipplingConnectionId] = useState<string | null>(null);

  // 2. Refs
  const connectionsRef = useRef<Connection[]>([]);


  // Check vibration support
  useEffect(() => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      setVibrateSupported(true);
    }
  }, []);

  // Sync connectionsRef with state
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);


  // Play audio waves
  const playPokeAudio = (freq = 440) => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      // Sweeping frequency to simulate wave ripple physics
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.65);

      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.65);
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  const playSendAudio = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(140, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(580, audioCtx.currentTime + 0.4);

      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  // Perform phone vibration
  const triggerVibrate = (pattern: number | number[]) => {
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (err) {
        console.warn("Vibration rejected by system", err);
      }
    }
  };

  // Generate self-contained custom invitation URL
  const inviteUrl = useMemo(() => {
    if (!user) return "";
    const cleanUrl = window.location.origin + window.location.pathname;
    return `${cleanUrl}?invite=${user.id}&name=${encodeURIComponent(
      user.name
    )}&color=${encodeURIComponent(user.color)}`;
  }, [user]);

  // Handle Copy Invite Link
  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    triggerVibrate(30);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // 3. App Initialization and URL Query parsing
  useEffect(() => {
    // Parse query parameters
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get("invite");
    const inviteName = params.get("name");
    const inviteColor = params.get("color");

    if (inviteId && inviteName) {
      setInviteInfo({
        id: inviteId,
        name: inviteName,
        color: inviteColor || "#ec4899",
      });
    }

    // Load user profile from LocalStorage if present
    const storedUserStr = localStorage.getItem("pulse_poke_user");
    if (storedUserStr) {
      try {
        const storedUser = JSON.parse(storedUserStr);
        if (storedUser && storedUser.id && storedUser.name) {
          setUser(storedUser);
          setOnboarding(false);
        }
      } catch (err) {
        console.error("Failed to parse stored user profile", err);
      }
    }
    setLoading(false);
  }, []);

  // 4. Real-time Synchronization & Presence
  useEffect(() => {
    if (!user) return;

    // A. Subscriptions to Connections
    const q = query(
      collection(db, "connections"),
      or(
        where("user1Id", "==", user.id),
        where("user2Id", "==", user.id)
      )
    );

    const unsubConnections = onSnapshot(
      q,
      (snapshot) => {
        setSyncConnected(true);
        setErrorMsg(null);

        const connList: Connection[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          connList.push({
            id: data.id,
            user1Id: data.user1Id,
            user2Id: data.user2Id,
            user1Name: data.user1Name,
            user2Name: data.user2Name,
            user1Color: data.user1Color,
            user2Color: data.user2Color,
            pokesCount: data.pokesCount,
            lastPokeTime: data.lastPokeTime,
            lastPokeFrom: data.lastPokeFrom,
          });
        });

        // Detect new incoming pokes
        snapshot.docChanges().forEach((change) => {
          if (change.type === "modified") {
            const conn = change.doc.data();
            if (conn.lastPokeFrom && conn.lastPokeFrom !== user.id) {
              const prevConn = connectionsRef.current.find((c) => c.id === conn.id);
              const prevCount = prevConn ? prevConn.pokesCount : 0;
              if (conn.pokesCount > prevCount) {
                const partnerName = conn.user1Id === user.id ? conn.user2Name : conn.user1Name;
                const partnerColor = conn.user1Id === user.id ? conn.user2Color : conn.user1Color;

                playPokeAudio(380);
                triggerVibrate([150, 100, 150, 100, 200]);

                setActivePoke({
                  id: Date.now().toString(),
                  fromUserId: conn.lastPokeFrom,
                  fromUserName: partnerName,
                  fromUserColor: partnerColor,
                  timestamp: Date.now(),
                });

                setRipplingConnectionId(conn.id);
                setTimeout(() => setRipplingConnectionId(null), 2500);
              }
            }
          }
        });

        setConnections(connList);
      },
      (error) => {
        console.error("Firestore snapshot error", error);
        setSyncConnected(false);
        setErrorMsg("Failed to synchronize connections...");
      }
    );

    // B. Presence Tracker
    const userRef = doc(db, "users", user.id);
    const setPresence = async (online: boolean) => {
      try {
        await setDoc(userRef, {
          id: user.id,
          name: user.name,
          color: user.color,
          isOnline: online,
          lastActive: Date.now()
        });
      } catch (err) {
        console.error("Presence status set failed", err);
      }
    };

    setPresence(true);

    const heartbeat = setInterval(() => {
      setPresence(true);
    }, 25000);

    const handleFocus = () => setPresence(true);
    const handleBlur = () => setPresence(false);
    const handleBeforeUnload = () => setPresence(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("beforeunload", handleBeforeUnload);

    // C. Auto Invite Accept handler
    if (inviteInfo && inviteInfo.id !== user.id) {
      const connId = [user.id, inviteInfo.id].sort().join("_");
      const connRef = doc(db, "connections", connId);
      
      const setupInviteConnection = async () => {
        try {
          const connSnap = await getDoc(connRef);
          if (!connSnap.exists()) {
            await setDoc(connRef, {
              id: connId,
              user1Id: user.id,
              user2Id: inviteInfo.id,
              user1Name: user.name,
              user2Name: inviteInfo.name,
              user1Color: user.color,
              user2Color: inviteInfo.color,
              pokesCount: 0,
              lastPokeTime: Date.now(),
              lastPokeFrom: ""
            });
          }

          // Register other user placeholder if needed
          const otherRef = doc(db, "users", inviteInfo.id);
          const otherSnap = await getDoc(otherRef);
          if (!otherSnap.exists()) {
            await setDoc(otherRef, {
              id: inviteInfo.id,
              name: inviteInfo.name,
              color: inviteInfo.color,
              isOnline: false,
              lastActive: Date.now() - 3600 * 1000
            });
          }

          setInviteAccepted(true);
          playSendAudio();
        } catch (err) {
          console.error("Auto invite accept failed", err);
        }
      };

      setupInviteConnection();
    }

    return () => {
      unsubConnections();
      clearInterval(heartbeat);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      setPresence(false);
    };
  }, [user, inviteInfo]);

  // D. Subscription to partner user presences
  useEffect(() => {
    if (!user || connections.length === 0) return;

    const partnerIds: string[] = Array.from(
      new Set(
        connections.map((c) => (c.user1Id === user.id ? c.user2Id : c.user1Id))
      )
    );

    const unsubs = partnerIds.map((partnerId: string) => {
      return onSnapshot(doc(db, "users", partnerId), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setPartnersPresence((prev) => ({
            ...prev,
            [partnerId]: {
              isOnline: data.isOnline ?? false,
              lastActive: data.lastActive ?? 0,
            },
          }));
        }
      });
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [user, connections]);

  // 5. Complete Profile Setup Onboarding
  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempName.trim()) return;

    const generatedId = "user_" + Math.random().toString(36).substring(2, 11);
    const newProfile: User = {
      id: generatedId,
      name: tempName.trim(),
      color: selectedColor,
    };

    try {
      const userRef = doc(db, "users", generatedId);
      await setDoc(userRef, {
        id: generatedId,
        name: tempName.trim(),
        color: selectedColor,
        isOnline: true,
        lastActive: Date.now()
      });

      // Store in LocalStorage and trigger state
      localStorage.setItem("pulse_poke_user", JSON.stringify(newProfile));
      setUser(newProfile);
      setOnboarding(false);
      playSendAudio();
    } catch (err) {
      console.error("Onboarding register failed", err);
      // Fallback
      localStorage.setItem("pulse_poke_user", JSON.stringify(newProfile));
      setUser(newProfile);
      setOnboarding(false);
    }
  };

  // 6. Action: Send a poke wave
  const sendPoke = async (targetUserId: string, connId: string) => {
    if (!user) return;

    // Local physical feedback
    playSendAudio();
    triggerVibrate(60);

    // Dynamic wave visual trigger
    setRipplingConnectionId(connId);
    setTimeout(() => {
      if (ripplingConnectionId === connId) {
        setRipplingConnectionId(null);
      }
    }, 2400);

    try {
      const connRef = doc(db, "connections", connId);
      const connSnap = await getDoc(connRef);
      if (connSnap.exists()) {
        const currentData = connSnap.data();
        const currentCount = currentData.pokesCount || 0;

        await setDoc(connRef, {
          id: connId,
          user1Id: currentData.user1Id,
          user2Id: currentData.user2Id,
          user1Name: currentData.user1Id === user.id ? user.name : currentData.user1Name,
          user2Name: currentData.user2Id === user.id ? user.name : currentData.user2Name,
          user1Color: currentData.user1Id === user.id ? user.color : currentData.user1Color,
          user2Color: currentData.user2Id === user.id ? user.color : currentData.user2Color,
          pokesCount: currentCount + 1,
          lastPokeTime: Date.now(),
          lastPokeFrom: user.id
        });
      }
    } catch (err) {
      console.error("Failed to send poke wave via Firestore", err);
    }
  };

  // 7. Manual connect via typed User ID
  const connectManually = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !manualInviteId.trim()) return;

    const cleanId = manualInviteId.trim();
    if (cleanId === user.id) {
      alert("You cannot poke your own self! Connect with someone else.");
      return;
    }

    try {
      const connId = [user.id, cleanId].sort().join("_");
      const connRef = doc(db, "connections", connId);
      const connSnap = await getDoc(connRef);

      if (!connSnap.exists()) {
        await setDoc(connRef, {
          id: connId,
          user1Id: user.id,
          user2Id: cleanId,
          user1Name: user.name,
          user2Name: "Friend",
          user1Color: user.color,
          user2Color: "#00f2fe",
          pokesCount: 0,
          lastPokeTime: Date.now(),
          lastPokeFrom: ""
        });

        // Also register default placeholder other user if needed
        const otherRef = doc(db, "users", cleanId);
        const otherSnap = await getDoc(otherRef);
        if (!otherSnap.exists()) {
          await setDoc(otherRef, {
            id: cleanId,
            name: "Friend",
            color: "#00f2fe",
            isOnline: false,
            lastActive: Date.now() - 3600 * 1000
          });
        }
      }

      setManualInviteId("");
      setShareOpen(false);
      playSendAudio();

      // Immediately poke them to start connection
      sendPoke(cleanId, connId);
    } catch (err) {
      console.error("Manual connect failed", err);
      alert("Could not establish link. Please try again.");
    }
  };


  // Render Loading placeholder
  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center font-sans dot-bg">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-4 border-[#ff00f5]/10 animate-pulse"></div>
          <div className="absolute inset-0 rounded-full border-4 border-t-[#00f3ff] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
        </div>
        <p className="mt-6 text-zinc-500 font-mono text-xs tracking-[0.3em] uppercase animate-pulse">
          INITIALIZING WAVE NETWORK...
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden selection:bg-[#ff00f5]/30 dot-bg">
      {/* Decorative ambient neon orbs in corner */}
      <div className="absolute top-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-br from-[#ff00f5]/10 to-transparent blur-3xl pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-[#00f3ff]/10 to-transparent blur-3xl pointer-events-none z-0" />

      {/* HEADER BAR */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-white/5 backdrop-blur-md bg-[#050505]/40">
        <div className="flex flex-col">
          <h1 className="text-4xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#ff00f5]">
            PULSE
          </h1>
          <span className="hidden sm:inline-block text-[10px] uppercase tracking-[0.4em] opacity-40">
            Sub-vocal network / active
          </span>
        </div>

        {/* Network & Config Controls */}
        <div className="flex items-center gap-4">
          {/* Connection status indicator */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-mono tracking-wider transition-all ${
              syncConnected
                ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400"
                : "bg-amber-950/20 border-amber-500/30 text-amber-400"
            }`}
          >
            {syncConnected ? (
              <>
                <Wifi className="w-3 h-3 text-emerald-400" />
                <span className="hidden xs:inline">ONLINE GRID</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-amber-400" />
                <span className="hidden xs:inline">DISCONNECTED</span>
              </>
            )}
          </div>

          {/* Sound Toggle Button */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-3 rounded-full glass hover:scale-105 text-zinc-400 hover:text-white transition-all cursor-pointer"
            title={soundEnabled ? "Mute audio" : "Enable sound"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-zinc-600" />}
          </button>

          {/* Core Invitation Add Button (Sleek Rounded Glass style) */}
          {user && (
            <button
              onClick={() => setShareOpen(true)}
              className="w-16 h-16 rounded-full glass flex items-center justify-center hover:scale-105 transition-all text-white border border-white/10 hover:border-white/20 hover:text-white cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.05)]"
              title="Add Person"
            >
              <Plus className="w-7 h-7 text-[#00f3ff]" />
            </button>
          )}
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="relative z-10 flex-1 overflow-y-auto w-full max-w-7xl mx-auto px-6 py-8 flex flex-col justify-center">
        {/* Connection status error ribbon */}
        {errorMsg && (
          <div className="mb-8 mx-auto max-w-md w-full bg-amber-950/20 border border-amber-500/25 rounded-xl p-4 flex items-center gap-3 text-amber-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            {errorMsg}
          </div>
        )}

        {/* 1. Onboarding Screen */}
        {onboarding ? (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full mx-auto glass rounded-3xl p-8 shadow-2xl glow-glass"
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[#ff00f5] to-[#00f3ff] p-0.5 mx-auto mb-5 animate-float">
                <div className="w-full h-full bg-[#050505] rounded-full flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-[#ff00f5]" />
                </div>
              </div>
              <h2 className="text-3xl font-bold tracking-tighter text-white mb-2 font-sans">
                Set Your Wave Identity
              </h2>
              <p className="text-zinc-400 text-xs font-light leading-relaxed">
                Colleagues, couples, and friends use Pulse to nudge each other over the active sub-vocal net with real vibration pokes.
              </p>
            </div>

            <form onSubmit={handleOnboardingSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-mono tracking-[0.2em] text-zinc-500 uppercase mb-2">
                  YOUR SIGNATURE NAME
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. LIAM, EMMA, ALEX"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  maxLength={18}
                  className="w-full bg-white/5 border border-white/10 focus:border-[#ff00f5] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-zinc-700 font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono tracking-[0.2em] text-zinc-500 uppercase mb-2">
                  CHOOSE GLOW CHROMATIC
                </label>
                <div className="flex items-center justify-between gap-3 p-2 bg-black/40 rounded-2xl border border-white/5">
                  {GLOW_COLORS.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => {
                        setSelectedColor(col.hex);
                        triggerVibrate(30);
                        playPokeAudio(300);
                      }}
                      style={{ backgroundColor: col.hex }}
                      className={`w-10 h-10 rounded-full relative cursor-pointer transition-transform ${
                        selectedColor === col.hex
                          ? "scale-110 ring-4 ring-white/20 border-2 border-[#050505]"
                          : "opacity-60 hover:opacity-100"
                      }`}
                      title={col.name}
                    >
                      {selectedColor === col.hex && (
                        <div
                          className="absolute inset-[-6px] rounded-full opacity-75 pointer-events-none"
                          style={{
                            border: `2px solid ${col.hex}`,
                            boxShadow: `0 0 14px ${col.hex}`,
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Invitation warning if coming from link */}
              {inviteInfo && (
                <div className="p-4 bg-[#00f3ff]/5 border border-[#00f3ff]/10 rounded-2xl flex items-start gap-3">
                  <div className="p-1 rounded bg-[#00f3ff]/10 text-[#00f3ff] mt-0.5">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#00f3ff]">
                      Connecting with {inviteInfo.name}
                    </h4>
                    <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                      Setting up your signature will instantly pair {inviteInfo.name} into your active pulse matrix.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!tempName.trim()}
                className={`w-full py-4 rounded-xl font-bold tracking-widest text-xs uppercase transition-all text-black relative cursor-pointer ${
                  tempName.trim()
                    ? "bg-white hover:bg-[#00f3ff] transition-colors shadow-[0_0_20px_rgba(255,255,255,0.15)]"
                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-700"
                }`}
              >
                ESTABLISH LINK
              </button>
            </form>
          </motion.div>
        ) : (
          /* 2. MAIN ACTIVE DASHBOARD */
          <div className="w-full flex flex-col items-center">
            {/* Show local user profile display card */}
            <div className="mb-12 p-3 px-5 rounded-full glass border border-white/5 flex items-center gap-3 shadow-sm">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: user?.color,
                  boxShadow: `0 0 12px ${user?.color}`,
                }}
              />
              <span className="text-[11px] font-mono tracking-wider text-zinc-400">
                WAVE SIGNATURE: <strong className="text-white uppercase">{user?.name}</strong>
              </span>
              <div className="w-1 h-1 rounded-full bg-zinc-700" />
              <button
                onClick={() => {
                  if (confirm("Reset account and create a new signature?")) {
                    localStorage.removeItem("pulse_poke_user");
                    setUser(null);
                    setOnboarding(true);
                  }
                }}
                className="text-[10px] text-zinc-500 hover:text-[#ff00f5] font-mono tracking-wider uppercase transition-colors cursor-pointer"
              >
                Reset
              </button>
            </div>

            {/* Main Interactive Circle Grid */}
            {enrichedConnections.length === 0 ? (
              /* EMPTY STATE: Only a plus icon to poke first user */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md w-full text-center p-8 glass rounded-3xl"
              >
                <div className="w-24 h-24 mx-auto mb-6 relative">
                  <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#ff00f5]/30 animate-spin" style={{ animationDuration: "15s" }} />
                  <button
                    onClick={() => setShareOpen(true)}
                    className="absolute inset-3 bg-transparent border border-[#ff00f5]/80 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-105 glow-pink"
                  >
                    <Plus className="w-8 h-8 text-[#ff00f5] animate-pulse" />
                  </button>
                </div>

                <h3 className="text-xl font-bold text-white mb-2 font-sans tracking-tight">
                  No Active Connections
                </h3>
                <p className="text-zinc-400 text-xs font-light leading-relaxed mb-6">
                  You are currently offline in the physical wave grid. Tap below to transmit your custom link to your partner or colleague.
                </p>

                <button
                  onClick={() => setShareOpen(true)}
                  className="w-full py-3.5 rounded-full bg-white text-black font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer hover:bg-[#00f3ff] transition-colors uppercase tracking-wider"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Transmit Link
                </button>
              </motion.div>
            ) : (
              /* ACTIVE STATE: Display all connected partner circles matching "Sophisticated Dark" spec */
              <div className="w-full">
                <div className="text-center mb-12">
                  <p className="text-[10px] font-mono tracking-[0.3em] text-zinc-500 uppercase">
                    NEURAL GRID STATIONS
                  </p>
                  <h3 className="text-3xl font-bold tracking-tight text-white mt-1.5 font-sans">
                    Tap node to initiate poke wave
                  </h3>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-12 max-w-5xl mx-auto">
                  {enrichedConnections.map((conn) => {
                    const partnerId = conn.user1Id === user?.id ? conn.user2Id : conn.user1Id;
                    const partnerName = conn.user1Id === user?.id ? conn.user2Name : conn.user1Name;
                    const partnerColor = conn.user1Id === user?.id ? conn.user2Color : conn.user1Color;
                    const isOnline = conn.partnerOnline !== false;

                    // Match custom glow colors and classes
                    const matchedColObj = GLOW_COLORS.find(c => c.hex.toLowerCase() === partnerColor.toLowerCase()) || GLOW_COLORS[0];
                    const glowClass = matchedColObj.glowClass;

                    // Sophisticated size matching design: Large (64x64 or w-64 h-64 equivalent)
                    const isRippling = ripplingConnectionId === conn.id;

                    return (
                      <motion.div
                        key={conn.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center group relative"
                      >
                        {/* Interactive Wave Orb */}
                        <div
                          className={`relative w-64 h-64 rounded-full bg-transparent flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105 ${glowClass}`}
                          onClick={() => sendPoke(partnerId, conn.id)}
                        >
                          {/* Real-time wave ripple animations when poked/rippling */}
                          <AnimatePresence>
                            {(isRippling || (conn.lastPokeFrom === partnerId && conn.pokesCount > 0)) && (
                              <>
                                <div
                                  className="absolute inset-0 rounded-full animate-wave pointer-events-none"
                                  style={{ border: `1.5px solid ${partnerColor}` }}
                                />
                                <div
                                  className="absolute inset-0 rounded-full animate-wave-delay-1 pointer-events-none"
                                  style={{ border: `1px solid ${partnerColor}` }}
                                />
                                <div
                                  className="absolute inset-0 rounded-full animate-wave-delay-2 pointer-events-none"
                                  style={{ border: `0.5px solid ${partnerColor}` }}
                                />
                              </>
                            )}
                          </AnimatePresence>

                          {/* Constant subtle pulsing background */}
                          <div
                            className="absolute inset-6 rounded-full opacity-5 blur-2xl animate-pulse transition-all group-hover:opacity-15"
                            style={{ backgroundColor: partnerColor }}
                          />

                          {/* Theme Specific Minimal Text Representation */}
                          <div className="text-2xl font-light tracking-[0.1em] text-white uppercase">
                            {partnerName}
                          </div>
                          
                          <div className="text-[11px] uppercase tracking-wider text-white/50 mt-1">
                            {conn.pokesCount} POKES
                          </div>

                          {/* Decorative pulses inside the node */}
                          <div className="mt-4 flex gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: partnerColor }} />
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: partnerColor }} />
                            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: partnerColor }} />
                          </div>

                          {/* Sleek status badge at the top */}
                          <div className="absolute top-4 flex items-center justify-center">
                            <span
                              className={`w-2 h-2 rounded-full transition-all ${
                                isOnline ? "bg-[#00f3ff]" : "bg-zinc-700"
                              }`}
                              style={{
                                boxShadow: isOnline ? `0 0 10px ${partnerColor}` : "none",
                              }}
                            />
                            <span className="text-[8px] font-mono tracking-wider ml-1.5 text-zinc-500 uppercase">
                              {isOnline ? "SYNC" : "OFF"}
                            </span>
                          </div>
                        </div>

                        {/* Outer Tag Label */}
                        <div className="mt-4 text-center">
                          <span className="text-[10px] font-mono tracking-[0.2em] text-zinc-500 uppercase">
                            {isOnline ? "STREAM ACTIVE" : "STATION ASYNC"}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* FOOTER STATS MATCHING SOPHISTICATED DARK */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-8 border-t border-white/5 flex justify-between items-end opacity-40 text-[10px] uppercase tracking-[0.2em] font-sans">
        <div className="flex gap-8">
          <div>STATUS: ENCRYPTED</div>
          <div>LATENCY: {syncConnected ? "12MS" : "N/A"}</div>
        </div>
        <div>EST. 2026 / DISTANT PHYSICALITY</div>
      </footer>

      {/* FLOATING POKE INCOMING DIALOG BAR (Theme 1-to-1 spec) */}
      <AnimatePresence>
        {activePoke && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[500px] px-4 z-50"
          >
            <div className="glass rounded-3xl p-6 flex items-center justify-between shadow-2xl border border-white/10 glow-glass bg-black/80">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#00f3ff] to-blue-600 animate-pulse shadow-[0_0_20px_rgba(0,243,255,0.6)]"></div>
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-widest opacity-50 font-mono">Incoming Wave</div>
                  <div className="text-base font-medium text-white">{activePoke.fromUserName} is poking you</div>
                </div>
              </div>
              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    const matchedConn = enrichedConnections.find(
                      (c) =>
                        (c.user1Id === user?.id && c.user2Id === activePoke.fromUserId) ||
                        (c.user2Id === user?.id && c.user1Id === activePoke.fromUserId)
                    );
                    if (matchedConn) {
                      sendPoke(activePoke.fromUserId, matchedConn.id);
                    }
                    setActivePoke(null);
                  }}
                  className="px-6 py-2 rounded-full bg-white text-black font-semibold text-sm hover:bg-[#00f3ff] hover:text-black transition-colors cursor-pointer"
                >
                  POKE BACK
                </button>
                <button
                  onClick={() => {
                    setActivePoke(null);
                    triggerVibrate(30);
                  }}
                  className="px-4 py-2 rounded-full glass text-xs opacity-60 hover:opacity-100 transition-opacity cursor-pointer text-white"
                >
                  CLOSE
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SHARE / INVITATION OVERLAY DIALOG */}
      <AnimatePresence>
        {shareOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#050505]/90 backdrop-blur-md z-40 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="max-w-md w-full glass rounded-3xl p-8 relative shadow-2xl border border-white/10"
            >
              <button
                onClick={() => setShareOpen(false)}
                className="absolute top-5 right-5 text-zinc-500 hover:text-white cursor-pointer p-1.5 rounded-full hover:bg-white/5 transition-all"
              >
                <X className="w-4 h-4" />
              </button>

              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2 font-sans tracking-tight">
                <Share2 className="w-5 h-5 text-[#ff00f5]" />
                Neural Connection Sync
              </h3>
              <p className="text-zinc-400 text-xs font-light leading-relaxed mb-6">
                Transmit your wave signature to partner devices. When opened, you'll be synchronized directly.
              </p>

              {/* Share Invite Code Field */}
              <div className="space-y-5">
                <div>
                  <span className="block text-[10px] font-mono tracking-wider text-zinc-500 uppercase mb-1.5">
                    TRANSMISSION URL
                  </span>
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl p-2.5 pl-4">
                    <span className="text-[11px] font-mono text-zinc-400 truncate flex-1 pr-2">
                      {inviteUrl}
                    </span>
                    <button
                      onClick={copyInvite}
                      className="p-2 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-white/5 hover:border-white/10 text-zinc-300 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                    >
                      {copiedLink ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-4 py-2">
                  <div className="h-[1px] bg-white/5 flex-1"></div>
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">OR CONNECT DIRECT</span>
                  <div className="h-[1px] bg-white/5 flex-1"></div>
                </div>

                <form onSubmit={connectManually} className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono tracking-wider text-zinc-500 uppercase mb-1.5">
                      ENTER FRIEND STATION CODE
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. user_x9s8d1"
                        value={manualInviteId}
                        onChange={(e) => setManualInviteId(e.target.value)}
                        className="bg-white/5 border border-white/10 focus:border-[#00f3ff] rounded-xl px-4 py-3 text-xs text-white outline-none flex-1 font-mono"
                      />
                      <button
                        type="submit"
                        disabled={!manualInviteId.trim()}
                        className="px-5 py-3 bg-white hover:bg-[#00f3ff] text-black font-semibold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        SYNC
                      </button>
                    </div>
                  </div>
                </form>

                {/* Local user identification display */}
                <div className="mt-6 p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-zinc-500 font-mono block tracking-wider">YOUR PRIVATE STATION ID</span>
                    <strong className="text-[#00f3ff] font-mono text-xs">{user?.id}</strong>
                  </div>
                  <button
                    onClick={() => {
                      if (user) {
                        navigator.clipboard.writeText(user.id);
                        triggerVibrate(30);
                        alert("Station ID copied!");
                      }
                    }}
                    className="text-zinc-500 hover:text-white p-2 hover:bg-white/5 rounded-lg transition-colors"
                    title="Copy User ID"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AUTO INVITE ACCEPTANCE SUCCESS OVERLAY NOTIFICATION */}
      <AnimatePresence>
        {inviteAccepted && inviteInfo && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4"
          >
            <div className="glass rounded-2xl p-4 shadow-2xl flex items-center justify-between border border-[#00f3ff]/30 bg-black/90">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#00f3ff]/10 flex items-center justify-center text-[#00f3ff] font-bold text-sm">
                  {inviteInfo.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Wave Link Sync complete!</h4>
                  <p className="text-[10px] text-zinc-400">
                    Connected in real-time with {inviteInfo.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInviteAccepted(false)}
                className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
