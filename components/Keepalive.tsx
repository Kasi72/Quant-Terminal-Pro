'use client';
import { useEffect } from 'react';

export default function Keepalive() {
  useEffect(() => {
    fetch('/api/keepalive').catch(() => {});
  }, []);
  return null;
}
