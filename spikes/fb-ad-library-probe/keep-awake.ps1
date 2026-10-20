# Runs a command while telling Windows not to sleep (SetThreadExecutionState), so a probe run is not cut
# short by sleep as the first off-screen run was. Usage: keep-awake.ps1 pnpm probe --modes headless
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$k = Add-Type -MemberDefinition $sig -Name Power -Namespace IdeasHubProbe -PassThru
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED; cleared when this process exits.
[void]$k::SetThreadExecutionState([uint32]'0x80000001')
$exe, $rest = $args
& $exe @rest
exit $LASTEXITCODE
