import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgb(59, 130, 245)',
          borderRadius: 7,
          color: '#fff',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -1,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        P
      </div>
    ),
    { ...size }
  );
}
