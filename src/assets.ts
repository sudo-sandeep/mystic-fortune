import pic1 from '../assets/Pic1.png';
import pic2 from '../assets/Pic2.png';
import pic3 from '../assets/Pic3.png';
import pic4 from '../assets/Pic4.png';
import pic5 from '../assets/Pic5.png';
import scatter from '../assets/scatter.png';
import king from '../assets/King.png';
import queen from '../assets/Queen.png';
import jack from '../assets/Jack.png';
import ace from '../assets/Ace.svg';
import ten from '../assets/Ten.svg';
import logo from '../assets/logo.png';
import background from '../assets/background.png';
import reelFrame from '../assets/reel-frame.svg';
import reelBackground from '../assets/reel-background.svg';
import type { SymbolName } from './reelConfig.ts';

// Imports make Vite validate, fingerprint, and package every symbol, including on subpaths.
export const SYMBOL_IMAGES: Record<SymbolName, string> = {
  Pic1: pic1, Pic2: pic2, Pic3: pic3, Pic4: pic4, Pic5: pic5,
  Scatter: scatter, King: king, Queen: queen, Jack: jack, Ace: ace, Ten: ten,
};

export async function preloadGameAssets(onProgress: (loaded: number, total: number) => void): Promise<void> {
  const sources = [...new Set([...Object.values(SYMBOL_IMAGES), logo, background, reelFrame, reelBackground])];
  let loaded = 0;
  onProgress(loaded, sources.length);
  await Promise.all(sources.map(src => new Promise<void>((resolve, reject) => {
    const image = new Image();
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else {
        onProgress(++loaded, sources.length);
        resolve();
      }
    };
    const timeout = setTimeout(() => finish(new Error(`Image loading timed out: ${src}`)), 30_000);
    image.decoding = 'async';
    image.onload = () => {
      if (typeof image.decode === 'function') void image.decode().then(() => finish(), finish);
      else finish();
    };
    image.onerror = () => finish(new Error(`Unable to load game image: ${src}`));
    image.src = src;
  })));
}
