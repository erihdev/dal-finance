#!/bin/bash
# متصفح دال في السحابة: شاشة افتراضية + عرض عن بُعد (noVNC) محمي بكلمة مرور + قارئ دوري للصفحات (قراءة فقط).
set -e
export DISPLAY=:99
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x860x24 -nolisten tcp &
sleep 1
fluxbox >/dev/null 2>&1 &
x11vnc -display :99 -localhost -forever -shared -nopw -quiet -rfbport 5900 >/dev/null 2>&1 &
websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/dev/null 2>&1 &
exec node /app/main.js
