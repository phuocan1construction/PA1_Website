@echo off
setlocal EnableDelayedExpansion

for %%f in (.) do set folderName=%%~nxf

for %%i in (*) do (
    if /I not "%%~xi"==".bat" (
        ren "%%i" "%folderName%_%%i"
    )
)

endlocal