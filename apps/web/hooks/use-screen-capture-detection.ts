'use client';

import { useEffect, useState } from 'react';

/**
 * useScreenCaptureDetection — ekran yozib olishni aniqlaydi.
 *
 * Strategiya:
 *  1. `getDisplayMedia` ni interceptsiya qilib, foydalanuvchi ekranini
 *     ulashmoqchi bo'lsa `isCapturing=true` ga o'tkazadi.
 *  2. `visibilitychange` — sahifa yashirilganda (alt-tab, boshqa oyna)
 *     kontent bulantiriladi.
 *  3. Brauzer oynasi fokusini yo'qotsa kontent yashiriladi.
 */
export function useScreenCaptureDetection() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    // getDisplayMedia ni interceptsiya qilamiz
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      const originalGetDisplayMedia =
        navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getDisplayMedia = async (constraints) => {
        setIsCapturing(true);
        try {
          const stream = await originalGetDisplayMedia(constraints);
          // Oqim to'xtaganda capturing=false
          stream.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', () => setIsCapturing(false));
          });
          return stream;
        } catch (err) {
          setIsCapturing(false);
          throw err;
        }
      };

      return () => {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
      };
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsHidden(document.hidden);
    };

    const handleBlur = () => setIsHidden(true);
    const handleFocus = () => setIsHidden(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return { isCapturing, isHidden };
}
