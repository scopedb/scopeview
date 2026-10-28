@echo off
"%~dp0..\runtime\node.exe" "%~dp0..\app\node\cli.mjs" %*
exit /b %errorlevel%
