import type React from 'react';

declare global {
  interface ModelViewerElement extends HTMLElement {
    canActivateAR?: boolean;
    activateAR?: () => void;
  }

  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
        src?: string;
        'ios-src'?: string;
        ar?: boolean | 'true' | 'false';
        'ar-modes'?: string;
        'camera-controls'?: boolean | 'true' | 'false';
        autoplay?: boolean | 'true' | 'false';
      };
    }
  }
}

export {};
