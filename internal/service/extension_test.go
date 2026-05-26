package service

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
)

func TestFormatJSPanicUsesJSErrorMessage(t *testing.T) {
	vm := goja.New()
	_, runErr := vm.RunString(`throw new Error("Login failed: wrong password")`)
	if runErr == nil {
		t.Fatal("expected JavaScript exception")
	}

	var ex *goja.Exception
	if !errors.As(runErr, &ex) {
		t.Fatalf("expected goja exception, got %T", runErr)
	}

	err := formatJSPanic(vm, ex)
	if err == nil {
		t.Fatal("expected formatted error")
	}
	if got, want := err.Error(), "Login failed: wrong password"; got != want {
		t.Fatalf("formatted error = %q, want %q", got, want)
	}
	if strings.Contains(err.Error(), "JS execution panic") {
		t.Fatalf("formatted error should not include panic prefix: %q", err.Error())
	}
}

func TestExtensionChoiceFlow(t *testing.T) {
	svc := &Service{}
	run := &ActiveRun{SessionID: "run_test"}
	var logs bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	selectedCh := make(chan []string, 1)
	errCh := make(chan error, 1)
	go func() {
		selected, err := svc.waitForExtensionChoice(ctx, run, &logs, "Pick volumes", []any{
			map[string]any{"id": "1", "label": "Vol 1"},
			map[string]any{"id": "2", "label": "Vol 2"},
		}, true)
		if err != nil {
			errCh <- err
			return
		}
		selectedCh <- selected
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		run.ChoiceMu.Lock()
		ready := run.ChoiceCh != nil
		run.ChoiceMu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("choice prompt was not registered")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !strings.Contains(logs.String(), `"type":"choice_required"`) {
		t.Fatalf("choice event was not written to logs: %s", logs.String())
	}
	if err := answerExtensionChoice(run, `["2"]`); err != nil {
		t.Fatalf("answer choice: %v", err)
	}

	select {
	case selected := <-selectedCh:
		if len(selected) != 1 || selected[0] != "2" {
			t.Fatalf("selected = %#v, want [2]", selected)
		}
	case err := <-errCh:
		t.Fatalf("choice returned error: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for selected choice")
	}
}
