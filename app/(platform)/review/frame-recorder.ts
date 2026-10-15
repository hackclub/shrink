// What runs inside the preview frame on the desk, so the replay shows the app (canvas
// included) and playing it counts as active time.
//
// The frame is an opaque origin, so the desk's rrweb can't see into it. Instead rrweb
// runs in there too and posts its events up (recordCrossOriginIframes), and real input
// is pinged up as activity. The ping carries a key only this tab knows, so a shipped
// app can't fake activity by posting messages itself; the script removes itself before
// the app runs, so the app can't read the key out of the page either.
export const FRAME_ACTIVITY = "shrink-activity";
// Sent down when the desk takes a full snapshot, which drops what was in the frame.
export const FRAME_SNAPSHOT = "shrink-snapshot";
export const FRAME_KEY = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "input", "touchstart"];
// Canvas is recorded as images, so keep it to a couple a second.
const CANVAS_FPS = 2;

const setup = `;(function () {
  var R = window.rrwebRecord, P = window.parent, K = ${JSON.stringify(FRAME_KEY)}, last = 0;
  try { delete window.rrwebRecord; } catch (e) {}
  if (document.currentScript) document.currentScript.remove();
  if (!R || P === window) return;
  try {
    R.record({
      recordCrossOriginIframes: true,
      recordCanvas: true,
      sampling: { mousemove: 50, scroll: 150, input: "last", canvas: ${CANVAS_FPS} },
      dataURLOptions: { type: "image/webp", quality: 0.6 },
      slimDOMOptions: "all",
      errorHandler: function () { return true; }
    });
  } catch (e) {}
  function act(e) {
    if (!e.isTrusted) return;
    var t = Date.now();
    if (t - last < 500) return;
    last = t;
    P.postMessage({ type: ${JSON.stringify(FRAME_ACTIVITY)}, key: K }, "*");
  }
  ${JSON.stringify(ACTIVITY)}.forEach(function (t) { window.addEventListener(t, act, { capture: true, passive: true }); });
  window.addEventListener("message", function (e) {
    if (e.source === P && e.data && e.data.type === ${JSON.stringify(FRAME_SNAPSHOT)}) try { R.record.takeFullSnapshot(false); } catch (err) {}
  });
})();`;

let loading: Promise<string> | null = null;

// The <script> to put in the frame's head. Empty if rrweb couldn't be fetched: the app
// still runs, it just isn't in the recording.
export function loadFrameRecorder(): Promise<string> {
  loading ??= fetch("/api/replay/frame")
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`rrweb: ${r.status}`))))
    // Nothing in rrweb's source can close the tag early, but make sure.
    .then((src) => `<script>${src.replaceAll("</script", "<\\/script")}\n${setup}</script>`)
    .catch((e) => {
      console.warn("[replay] preview won't be recorded:", e);
      loading = null;
      return "";
    });
  return loading;
}
