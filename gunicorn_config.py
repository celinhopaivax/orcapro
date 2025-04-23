import multiprocessing

workers = multiprocessing.cpu_count() * 2 + 1
timeout = 120  # Aumente o timeout para 2 minutos
keepalive = 5
worker_class = "sync"
bind = "0.0.0.0:10000"
