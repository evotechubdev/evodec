Option Explicit

Dim fso, shell, localAppData, installDir, scriptsDir, srcDir
Dim protocolRoot, launcherFile, openCommand, packageFile

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count > 0 Then
  If LCase(Trim(WScript.Arguments(0))) = "--check" Then
    WScript.Echo "INSTALAR_CONECTOR_WINDOWS.vbs validado."
    WScript.Quit 0
  End If
End If

If shell.Run("cmd.exe /d /c node.exe -e " & Quote("process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)") & " >nul 2>&1", 0, True) <> 0 Then
  Fail "Node.js 22 ou superior não foi encontrado neste computador. Instale o Node.js e execute este instalador novamente."
End If

localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
installDir = fso.BuildPath(fso.BuildPath(localAppData, "EVOTV"), "WindowsConnector")
scriptsDir = fso.BuildPath(installDir, "scripts")
srcDir = fso.BuildPath(installDir, "src")
EnsureFolder fso.BuildPath(localAppData, "EVOTV")
EnsureFolder installDir
EnsureFolder scriptsDir
EnsureFolder srcDir

packageFile = fso.BuildPath(installDir, "package.json")
WriteTextFile packageFile, "{""type"":""module""}"

DownloadFile "https://multimideas-evo-backend.onrender.com/api/windows-connector/bridge.js", fso.BuildPath(scriptsDir, "windows-web-bridge.js")
DownloadFile "https://multimideas-evo-backend.onrender.com/api/windows-connector/import.js", fso.BuildPath(scriptsDir, "import-shorts.js")
DownloadFile "https://multimideas-evo-backend.onrender.com/api/windows-connector/shorts.js", fso.BuildPath(srcDir, "shorts-imports.js")
launcherFile = fso.BuildPath(installDir, "PAINEL_WEB_WINDOWS.vbs")
DownloadFile "https://multimideas-evo-backend.onrender.com/api/windows-connector/launcher.vbs", launcherFile

protocolRoot = "HKCU\Software\Classes\evotv-import\"
openCommand = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")) & " " & Quote(launcherFile) & " " & Quote("%1")
shell.RegWrite protocolRoot, "URL:EVOTV Windows Connector", "REG_SZ"
shell.RegWrite protocolRoot & "URL Protocol", "", "REG_SZ"
shell.RegWrite protocolRoot & "DefaultIcon\", shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe") & ",0", "REG_SZ"
shell.RegWrite protocolRoot & "shell\open\command\", openCommand, "REG_SZ"

shell.Run Quote(launcherFile), 0, False
MsgBox "Conector Windows instalado e iniciado com sucesso." & vbCrLf & vbCrLf & _
  "Volte ao módulo de Mininovelas. O painel validará automaticamente este complemento.", _
  vbInformation, "EVOTV - Conector Windows"
shell.Run "https://evotechub.com.br/evotv/adm/", 1, False
WScript.Quit 0

Sub EnsureFolder(path)
  If Not fso.FolderExists(path) Then fso.CreateFolder path
End Sub

Sub WriteTextFile(path, content)
  Dim output
  Set output = fso.CreateTextFile(path, True, False)
  output.Write content
  output.Close
End Sub

Sub DownloadFile(url, destination)
  Dim request, stream
  Set request = CreateObject("MSXML2.XMLHTTP.6.0")
  request.Open "GET", url & "?v=" & CStr(Timer), False
  request.Send
  If request.Status <> 200 Then Fail "Não foi possível baixar um componente do conector (HTTP " & request.Status & ")."
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 1
  stream.Open
  stream.Write request.ResponseBody
  stream.SaveToFile destination, 2
  stream.Close
End Sub

Function Quote(value)
  Quote = Chr(34) & CStr(value) & Chr(34)
End Function

Sub Fail(message)
  MsgBox message, vbCritical, "EVOTV - Conector Windows"
  WScript.Quit 1
End Sub
