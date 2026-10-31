' Starts Koptic Desktop with the Electron that install.cmd downloaded, so
' it doesn't need Node.js on the PATH (which a fresh Node install only gets
' after signing out and back in).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
exe = here & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(exe) Then
  sh.Run """" & exe & """ .", 1, False
Else
  sh.Run "cmd /c npx --no-install electron .", 0, False
End If
