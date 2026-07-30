import os, time, paramiko
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.2.11', username='root', password=os.environ['DET_SSH_PASSWORD'], timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)
print('SSH_MONITOR_CONNECTED', flush=True)
for i in range(20):
    cmd="tail -4 /models_data/det-dashboard/runtime/npu-monitor.log 2>/dev/null; echo ---; ps -eo pid,pcpu,etime,cmd | awk '/mmcv-2.1.0|cc1plus|watch_npu|monitor_npu/ && !/awk/ {print}' | head -5"
    _,o,e=c.exec_command(cmd, timeout=60)
    print(o.read().decode(errors='replace'), flush=True)
    time.sleep(30)
c.close()
