/** AI UI 素材路径（tex/ai-ui） */

const BASE = './tex/ai-ui';

export const AI_EMOTION_ICON: Record<string, string> = {
  joy: `${BASE}/emotions/joy.svg`,
  anger: `${BASE}/emotions/anger.svg`,
  sadness: `${BASE}/emotions/sadness.svg`,
  surprise: `${BASE}/emotions/surprise.svg`,
  fear: `${BASE}/emotions/fear.svg`,
  disgust: `${BASE}/emotions/disgust.svg`,
  neutral: `${BASE}/emotions/neutral.svg`,
  thinking: `${BASE}/emotions/thinking.svg`,
};

export const AI_STATUS_ICON: Record<string, string> = {
  idle: `${BASE}/status/idle.svg`,
  talking: `${BASE}/status/talking.svg`,
  thinking: `${BASE}/status/thinking-wait.svg`,
  hurt: `${BASE}/status/hurt.svg`,
  busy: `${BASE}/status/busy.svg`,
};

export const AI_BUBBLE_STYLE: Record<string, string> = {
  dialogue: `${BASE}/bubbles/normal.svg`,
  whisper: `${BASE}/bubbles/whisper.svg`,
  shout: `${BASE}/bubbles/angry.svg`,
  narration: `${BASE}/bubbles/narration.svg`,
};

export const AI_PARTICLE: Record<string, string> = {
  heart: `${BASE}/particles/heart.svg`,
  star: `${BASE}/particles/star.svg`,
  anger: `${BASE}/particles/anger_burst.svg`,
  sweat: `${BASE}/particles/sweat.svg`,
  exclamation: `${BASE}/particles/exclamation.svg`,
};

export const AI_STATE_ICON: Record<string, string> = {
  hunger: `${BASE}/state_icons/hunger.svg`,
  thirst: `${BASE}/state_icons/thirst.svg`,
  fatigue: `${BASE}/state_icons/fatigue.svg`,
  inspired: `${BASE}/state_icons/inspired.svg`,
  fear_state: `${BASE}/state_icons/fear_state.svg`,
  affection: `${BASE}/state_icons/affection.svg`,
  jealousy: `${BASE}/state_icons/jealousy.svg`,
  angry_state: `${BASE}/state_icons/angry_state.svg`,
  calm: `${BASE}/state_icons/calm.svg`,
  injured: `${BASE}/state_icons/injured.svg`,
  poisoned: `${BASE}/state_icons/poisoned.svg`,
  radiation: `${BASE}/state_icons/radiation.svg`,
  cold: `${BASE}/state_icons/cold.svg`,
};

export const AI_WEATHER_OVERLAY: Record<string, string> = {
  night: `${BASE}/weather/night_overlay.svg`,
  dusk: `${BASE}/weather/dusk_overlay.svg`,
  rain: `${BASE}/weather/rain_overlay.svg`,
  sandstorm: `${BASE}/weather/sandstorm_overlay.svg`,
};

export function emotionIcon(emotion: string): string {
  return AI_EMOTION_ICON[emotion] ?? AI_EMOTION_ICON.neutral;
}

export function stateIcon(tag: string): string {
  return AI_STATE_ICON[tag] ?? AI_STATE_ICON.calm;
}
