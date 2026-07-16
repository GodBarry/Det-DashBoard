import { useEffect, useRef, useState } from "react";

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export function AuthenticatedImage({ src, onError, ...props }) {
  const [objectUrl, setObjectUrl] = useState("");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    let nextObjectUrl = "";
    setObjectUrl("");
    if (!src) return () => { active = false; };

    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`Image request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch((error) => {
        if (active) onErrorRef.current?.(error);
      });

    return () => {
      active = false;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [src]);

  return <img {...props} src={objectUrl || TRANSPARENT_PIXEL} />;
}

export default AuthenticatedImage;
