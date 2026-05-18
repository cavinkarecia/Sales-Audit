$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open("C:\Users\901842-Ezhil\OneDrive - CavinKare Private Limited\Desktop\CIA Excel Sources\Sudharsan\Auditor's Details.xlsx")

foreach($ws in $wb.Worksheets) {
    Write-Host "=== Sheet: $($ws.Name) ==="
    $usedRange = $ws.UsedRange
    $rows = $usedRange.Rows.Count
    $cols = $usedRange.Columns.Count
    Write-Host "Rows: $rows  Cols: $cols"
    
    for($r = 1; $r -le [Math]::Min($rows, 60); $r++) {
        $line = ""
        for($c = 1; $c -le $cols; $c++) {
            $val = $usedRange.Cells($r, $c).Text
            if ($c -gt 1) { $line += " | " }
            $line += $val
        }
        Write-Host $line
    }
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
