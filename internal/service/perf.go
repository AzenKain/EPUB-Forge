package service

import (
	"os"
	"runtime"
	"strconv"
	"sync"
)

func workerCount(taskCount int) int {
	if taskCount <= 1 {
		return 1
	}
	if raw := os.Getenv("EPUBFORGE_WORKERS"); raw != "" {
		if configured, err := strconv.Atoi(raw); err == nil && configured > 0 {
			if configured > taskCount {
				return taskCount
			}
			return configured
		}
	}

	workers := runtime.GOMAXPROCS(0)
	if workers < 1 {
		workers = 1
	}
	if workers > taskCount {
		return taskCount
	}
	return workers
}

func runWorkers(taskCount int, run func(int)) {
	if taskCount <= 0 {
		return
	}

	tasks := make(chan int)
	var wg sync.WaitGroup
	workers := workerCount(taskCount)
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for idx := range tasks {
				run(idx)
			}
		}()
	}
	for idx := 0; idx < taskCount; idx++ {
		tasks <- idx
	}
	close(tasks)
	wg.Wait()
}
