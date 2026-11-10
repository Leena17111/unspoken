/**
 * Webcam face tracking with MediaPipe Face Landmarker (runs fully in the browser; no video
 * leaves the device). Emits one FaceFrame of eye blendshapes per video frame.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceFrame } from './eyeSignal';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type CameraStatus = 'off' | 'loading' | 'running' | 'denied' | 'error';

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private lastVideoTime = -1;
  fps = 0;
  private frames = 0;
  private fpsAt = 0;

  constructor(private onFrame: (f: FaceFrame) => void, private onStatus: (s: CameraStatus, msg?: string) => void) {}

  async start(video: HTMLVideoElement) {
    this.video = video;
    this.onStatus('loading');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) {
      this.onStatus('denied', e instanceof Error ? e.message : String(e));
      return;
    }
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    try {
      if (!this.landmarker) {
        const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
        const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        });
        this.landmarker = await make('GPU').catch(() => make('CPU'));
      }
    } catch (e) {
      this.onStatus('error', `Face model failed to load: ${e instanceof Error ? e.message : e}`);
      return;
    }
    this.running = true;
    this.onStatus('running');
    this.loop();
  }

  private loop = () => {
    if (!this.running || !this.video || !this.landmarker) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t = performance.now();
      const res = this.landmarker.detectForVideo(v, t);
      const cats = res.faceBlendshapes?.[0]?.categories;
      if (cats) {
        const g = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
        this.onFrame({ t, present: true, blinkL: g('eyeBlinkLeft'), blinkR: g('eyeBlinkRight'),
          lookOutL: g('eyeLookOutLeft'), lookInL: g('eyeLookInLeft'), lookOutR: g('eyeLookOutRight'), lookInR: g('eyeLookInRight') });
      } else {
        this.onFrame({ t, present: false, blinkL: 0, blinkR: 0, lookOutL: 0, lookInL: 0, lookOutR: 0, lookInR: 0 });
      }
      this.frames++;
      if (t - this.fpsAt > 1000) { this.fps = Math.round((this.frames * 1000) / (t - this.fpsAt)); this.frames = 0; this.fpsAt = t; }
    }
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
    if (rvfc) rvfc.call(v, this.loop); else requestAnimationFrame(this.loop);
  };

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onStatus('off');
  }
}
